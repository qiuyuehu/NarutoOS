#include <dlfcn.h>
#include <crt_externs.h>
#include <fcntl.h>
#include <mach/mach_time.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/event.h>
#include <sys/select.h>
#include <sys/time.h>
#include <unistd.h>
#include "fishhook/fishhook.h"

#define MAX_SITES 16
#define MAX_TRACE_ENTRIES 96

static int (*original_gettimeofday)(struct timeval *, void *);
static int (*original_kevent)(int, const struct kevent *, int, struct kevent *, int, const struct timespec *);
static int (*original_kevent64)(int, const struct kevent64_s *, int, struct kevent64_s *, int, unsigned int, const struct timespec *);
static int (*original_poll)(struct pollfd *, nfds_t, int);
static int (*original_pthread_cond_timedwait)(pthread_cond_t *, pthread_mutex_t *, const struct timespec *);

static volatile int ready;
static __thread int in_hook;

static int trace_gtod;
static int trace_waits;
static int signal_switch;

static double rate_setting = 1.0;
static double speed = 1.0;
static int mode_none;
static struct timeval real_base;
static int64_t virtual_base_us;

static char site_modules[MAX_SITES][64];
static uint64_t site_offsets[MAX_SITES];
static int site_count;

struct trace_entry {
  void *pc;
  uintptr_t tid;
  int calls;
  int scaled;
};

static struct trace_entry entries[MAX_TRACE_ENTRIES];
static int entry_count;
static long overflow_calls;
static pthread_mutex_t trace_mutex = PTHREAD_MUTEX_INITIALIZER;
static long cur_bucket_sec = -1;

struct wait_stats {
  long count;
  long long sum_ms;
  long long min_ms;
  long long max_ms;
};

static struct wait_stats waits_kevent;
static struct wait_stats waits_cond;

static int should_hook_this_process(void) {
  const char *scope = getenv("NARUTO_SPEED_SCOPE");
  if (scope && strcmp(scope, "all") == 0) return 1;
  int argc = *_NSGetArgc();
  char **argv = *_NSGetArgv();
  for (int i = 0; i < argc; i++) {
    if (argv[i] && strcmp(argv[i], "--type=ppapi") == 0) return 1;
  }
  return 0;
}

static int64_t tv_to_us(struct timeval value) {
  return (int64_t)value.tv_sec * 1000000 + value.tv_usec;
}

static struct timeval us_to_tv(int64_t value) {
  struct timeval result;
  result.tv_sec = (long)(value / 1000000);
  result.tv_usec = (long)(value % 1000000);
  if (result.tv_usec < 0) { result.tv_usec += 1000000; result.tv_sec--; }
  return result;
}

static long long ts_to_ms(const struct timespec *ts) {
  if (!ts) return -1;
  return (long long)ts->tv_sec * 1000 + ts->tv_nsec / 1000000;
}

static const char *module_basename(const char *path) {
  if (!path) return "?";
  const char *slash = strrchr(path, '/');
  return slash ? slash + 1 : path;
}

static void log_line(const char *text, int length) {
  write(2, text, length);
}

static void log_key_value(const char *prefix, long long value) {
  char buffer[128];
  int length = snprintf(buffer, sizeof buffer, " %s=%lld", prefix, value);
  if (length > 0) log_line(buffer, length);
}

static void flush_bucket(long bucket_sec) {
  char head[64];
  int length = snprintf(head, sizeof head, "\nGTOD_TRACE bucket=%ld", bucket_sec);
  log_line(head, length);
  for (int i = 0; i < entry_count; i++) {
    Dl_info info;
    char line[256];
    if (dladdr(entries[i].pc, &info) && info.dli_fname) {
      uint64_t offset = (uint64_t)((char *)entries[i].pc - (char *)info.dli_fbase);
      length = snprintf(line, sizeof line, " [site=%s@%llx tid=%llx c=%d s=%d]",
                        module_basename(info.dli_fname), (unsigned long long)offset,
                        (unsigned long long)entries[i].tid, entries[i].calls, entries[i].scaled);
    } else {
      length = snprintf(line, sizeof line, " [site=unknown@%llx tid=%llx c=%d s=%d]",
                        (unsigned long long)(uintptr_t)entries[i].pc,
                        (unsigned long long)entries[i].tid, entries[i].calls, entries[i].scaled);
    }
    log_line(line, length);
  }
  if (overflow_calls > 0) log_key_value("overflow", overflow_calls);
  if (trace_waits) {
    if (waits_kevent.count > 0) {
      char line[160];
      length = snprintf(line, sizeof line, " [wait_kevent c=%ld min=%lld max=%lld]",
                        waits_kevent.count, waits_kevent.min_ms, waits_kevent.max_ms);
      log_line(line, length);
    }
    if (waits_cond.count > 0) {
      char line[160];
      length = snprintf(line, sizeof line, " [wait_cond c=%ld min=%lld max=%lld]",
                        waits_cond.count, waits_cond.min_ms, waits_cond.max_ms);
      log_line(line, length);
    }
  }
  log_line("\n", 1);
  entry_count = 0;
  overflow_calls = 0;
  memset(&waits_kevent, 0, sizeof waits_kevent);
  memset(&waits_cond, 0, sizeof waits_cond);
}

static void note_call(void *pc, int scaled) {
  uintptr_t tid = (uintptr_t)pthread_self();
  pthread_mutex_lock(&trace_mutex);
  for (int i = 0; i < entry_count; i++) {
    if (entries[i].pc == pc && entries[i].tid == tid) {
      entries[i].calls++;
      entries[i].scaled += scaled;
      pthread_mutex_unlock(&trace_mutex);
      return;
    }
  }
  if (entry_count < MAX_TRACE_ENTRIES) {
    entries[entry_count].pc = pc;
    entries[entry_count].tid = tid;
    entries[entry_count].calls = 1;
    entries[entry_count].scaled = scaled;
    entry_count++;
  } else {
    overflow_calls++;
  }
  pthread_mutex_unlock(&trace_mutex);
}

static void parse_sites(const char *spec) {
  char buffer[1024];
  if (!spec || !*spec) return;
  strncpy(buffer, spec, sizeof buffer - 1);
  buffer[sizeof buffer - 1] = 0;
  char *cursor = buffer;
  while (*cursor && site_count < MAX_SITES) {
    char *at = strchr(cursor, '@');
    if (!at) break;
    char *comma = strchr(at, ',');
    *at = 0;
    if (comma) *comma = 0;
    strncpy(site_modules[site_count], cursor, sizeof site_modules[0] - 1);
    site_offsets[site_count] = strtoull(at + 1, NULL, 16);
    site_count++;
    cursor = comma ? comma + 1 : at + strlen(at);
  }
}

static int pc_in_site_list(void *pc) {
  Dl_info info;
  if (!dladdr(pc, &info) || !info.dli_fname) return 0;
  const char *name = module_basename(info.dli_fname);
  uint64_t offset = (uint64_t)((char *)pc - (char *)info.dli_fbase);
  for (int i = 0; i < site_count; i++) {
    if (strcmp(site_modules[i], name) == 0 && site_offsets[i] == offset) return 1;
  }
  return 0;
}

struct site_cache_entry {
  void *pc;
  int decision;
  int valid;
};

static __thread struct site_cache_entry site_cache[MAX_SITES + 4];

static int caller_should_scale(void *pc) {
  for (int i = 0; i < (int)(sizeof site_cache / sizeof site_cache[0]); i++) {
    if (site_cache[i].valid && site_cache[i].pc == pc) return site_cache[i].decision;
  }
  int decision = pc_in_site_list(pc);
  for (int i = 0; i < (int)(sizeof site_cache / sizeof site_cache[0]); i++) {
    if (!site_cache[i].valid) {
      site_cache[i].pc = pc;
      site_cache[i].decision = decision;
      site_cache[i].valid = 1;
      break;
    }
  }
  return decision;
}

// 多档定向切档：每个档位对应一个信号（信号由内核投递，对 seatbelt 沙箱免疫；
// 文件通道经实测在沙箱收紧后不可读，已放弃）。信号幂等且不落盘，宿主无需读取
// 插件状态即可确定目标。采样真实时间、更新基准和计算虚拟时间共用同一把锁。
static volatile sig_atomic_t switch_target = 0;
static pthread_mutex_t switch_mutex = PTHREAD_MUTEX_INITIALIZER;

static int signal_rate(int signo) {
  switch (signo) {
    case SIGUSR2: return 1;
    case SIGUSR1: return 2;
    case SIGEMT: return 3;
    case SIGWINCH: return 4;
    case SIGINFO: return 5;
    case SIGTSTP: return 6;
    case SIGTTIN: return 7;
    case SIGTTOU: return 8;
    case SIGURG: return 9;
    case SIGXCPU: return 10;
  }
  return 0;
}

static void apply_pending_switch(struct timeval real_now) {
  // 原子交换取走并清零：读取与清零若为两步，落在中间的新信号会被清零覆盖。
  int chosen = __atomic_exchange_n(&switch_target, 0, __ATOMIC_RELAXED);
  if (!chosen) return;
  double new_speed = (double)chosen;
  if (new_speed == speed) return;
  int64_t current_virtual = virtual_base_us
      + (int64_t)((double)(tv_to_us(real_now) - tv_to_us(real_base)) * speed);
  virtual_base_us = current_virtual;
  real_base = real_now;
  speed = new_speed;
  char line[64];
  int length = snprintf(line, sizeof line, "\nGTOD_SWITCH speed=%.3f virtual_us=%lld",
                        new_speed, (long long)current_virtual);
  log_line(line, length);
}

static int scaled_gettimeofday(struct timeval *out, void *timezone) {
  if (!original_gettimeofday) _exit(126);
  if (in_hook) return original_gettimeofday(out, timezone);
  in_hook = 1;
  int scaled = 0;
  if (!mode_none) {
    if (!site_count) {
      scaled = 1;
    } else {
      scaled = caller_should_scale(__builtin_return_address(0)) ? 1 : -1;
    }
  }
  int lock_time = scaled == 1 || (signal_switch && __atomic_load_n(&switch_target, __ATOMIC_RELAXED));
  if (lock_time) pthread_mutex_lock(&switch_mutex);
  struct timeval current;
  int result = original_gettimeofday(&current, timezone);
  if (result == 0 && out) {
    if (lock_time && signal_switch) apply_pending_switch(current);
    *out = scaled == 1
        ? us_to_tv(virtual_base_us + (int64_t)((double)(tv_to_us(current) - tv_to_us(real_base)) * speed))
        : current;
  }
  if (lock_time) pthread_mutex_unlock(&switch_mutex);
  if (result != 0 || !out) { in_hook = 0; return result; }
  if (trace_gtod) {
    if (current.tv_sec != cur_bucket_sec) {
      long previous = cur_bucket_sec;
      cur_bucket_sec = current.tv_sec;
      if (previous >= 0) flush_bucket(previous);
    }
    note_call(__builtin_return_address(0), scaled > 0 ? 1 : 0);
  }
  in_hook = 0;
  return result;
}

static void note_wait_kevent(const struct timespec *timeout) {
  long long ms = ts_to_ms(timeout);
  if (ms < 0) ms = -1;
  pthread_mutex_lock(&trace_mutex);
  waits_kevent.count++;
  if (ms >= 0) {
    waits_kevent.sum_ms += ms;
    if (waits_kevent.min_ms == 0 || ms < waits_kevent.min_ms) waits_kevent.min_ms = ms;
    if (ms > waits_kevent.max_ms) waits_kevent.max_ms = ms;
  }
  pthread_mutex_unlock(&trace_mutex);
}

static int hooked_kevent(int kq, const struct kevent *changelist, int nchanges,
                         struct kevent *eventlist, int nevents, const struct timespec *timeout) {
  if (!original_kevent) _exit(126);
  if (in_hook) return original_kevent(kq, changelist, nchanges, eventlist, nevents, timeout);
  in_hook = 1;
  if (trace_waits) note_wait_kevent(timeout);
  in_hook = 0;
  return original_kevent(kq, changelist, nchanges, eventlist, nevents, timeout);
}

static int hooked_kevent64(int kq, const struct kevent64_s *changelist, int nchanges,
                           struct kevent64_s *eventlist, int nevents, unsigned int flags,
                           const struct timespec *timeout) {
  if (!original_kevent64) _exit(126);
  if (in_hook) return original_kevent64(kq, changelist, nchanges, eventlist, nevents, flags, timeout);
  in_hook = 1;
  if (trace_waits) note_wait_kevent(timeout);
  in_hook = 0;
  return original_kevent64(kq, changelist, nchanges, eventlist, nevents, flags, timeout);
}

static void note_wait_cond(const struct timespec *deadline) {
  if (!deadline) return;
  struct timeval now;
  original_gettimeofday(&now, NULL);
  long long delta = (long long)(deadline->tv_sec - now.tv_sec) * 1000
      + (deadline->tv_nsec / 1000000 - now.tv_usec / 1000);
  pthread_mutex_lock(&trace_mutex);
  waits_cond.count++;
  waits_cond.sum_ms += delta;
  if (waits_cond.min_ms == 0 || delta < waits_cond.min_ms) waits_cond.min_ms = delta;
  if (delta > waits_cond.max_ms) waits_cond.max_ms = delta;
  pthread_mutex_unlock(&trace_mutex);
}

static int hooked_pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex,
                                         const struct timespec *deadline) {
  if (!original_pthread_cond_timedwait) _exit(126);
  if (in_hook) return original_pthread_cond_timedwait(cond, mutex, deadline);
  in_hook = 1;
  if (trace_waits) note_wait_cond(deadline);
  in_hook = 0;
  return original_pthread_cond_timedwait(cond, mutex, deadline);
}

static int hooked_poll(struct pollfd *fds, nfds_t nfds, int timeout_ms) {
  if (!original_poll) _exit(126);
  if (in_hook) return original_poll(fds, nfds, timeout_ms);
  in_hook = 1;
  if (trace_waits && timeout_ms > 0) {
    pthread_mutex_lock(&trace_mutex);
    waits_kevent.count++;
    waits_kevent.sum_ms += timeout_ms;
    if (waits_kevent.min_ms == 0 || timeout_ms < waits_kevent.min_ms) waits_kevent.min_ms = timeout_ms;
    if (timeout_ms > waits_kevent.max_ms) waits_kevent.max_ms = timeout_ms;
    pthread_mutex_unlock(&trace_mutex);
  }
  in_hook = 0;
  return original_poll(fds, nfds, timeout_ms);
}

static void handle_switch_signal(int signo) {
  __atomic_store_n(&switch_target, signal_rate(signo), __ATOMIC_RELAXED);
}

__attribute__((constructor)) static void install_hook(void) {
  if (!should_hook_this_process()) return;
  write(2, "GTOD_HOOK_PPAPI\n", 16);
  const char *trace = getenv("NARUTO_TRACE_GTOD");
  if (trace && strcmp(trace, "1") == 0) trace_gtod = 1;
  const char *waits = getenv("NARUTO_TRACE_WAITS");
  if (waits && strcmp(waits, "1") == 0) trace_waits = 1;
  const char *sw = getenv("NARUTO_SIGNAL_SWITCH");
  if (sw && strcmp(sw, "1") == 0) signal_switch = 1;
  const char *mode = getenv("NARUTO_GSCALE_MODE");
  if (!mode || strcmp(mode, "none") == 0) {
    mode_none = 1;
  } else if (strcmp(mode, "all") == 0) {
    /* scale every call */
  } else if (strcmp(mode, "sites") == 0) {
    parse_sites(getenv("NARUTO_GSCALE_SITES"));
    if (!site_count) mode_none = 1;
  }
  const char *rate = getenv("NARUTO_GSCALE_RATE");
  if (rate && *rate) {
    char *end = NULL;
    double candidate = strtod(rate, &end);
    if (end != rate && *end == 0 && candidate >= 0.1 && candidate <= 10.0) rate_setting = candidate;
  }
  gettimeofday(&real_base, NULL);
  virtual_base_us = tv_to_us(real_base);
  speed = rate_setting;
  if (signal_switch) {
    const char *start = getenv("NARUTO_GSCALE_START");
    if (start && strcmp(start, "1") == 0) speed = 1.0;
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_handler = handle_switch_signal;
    for (int signo = 1; signo < 32; signo++) {
      if (signal_rate(signo) > 0) sigaction(signo, &action, NULL);
    }
  }
  struct rebinding bindings[5];
  size_t count = 0;
  bindings[count++] = (struct rebinding){ "gettimeofday", (void *)scaled_gettimeofday, (void **)&original_gettimeofday };
  int bind_waits = trace_waits;
  if (bind_waits) {
    bindings[count++] = (struct rebinding){ "kevent", (void *)hooked_kevent, (void **)&original_kevent };
    bindings[count++] = (struct rebinding){ "kevent64", (void *)hooked_kevent64, (void **)&original_kevent64 };
    bindings[count++] = (struct rebinding){ "pthread_cond_timedwait", (void *)hooked_pthread_cond_timedwait, (void **)&original_pthread_cond_timedwait };
    bindings[count++] = (struct rebinding){ "poll", (void *)hooked_poll, (void **)&original_poll };
  }
  if (rebind_symbols(bindings, count) != 0 || !original_gettimeofday) _exit(127);
  if (bind_waits && (!original_kevent || !original_kevent64 || !original_pthread_cond_timedwait || !original_poll)) {
    /* keep running; waits logging may be partial */
  }
  if (signal_switch) {
    struct sigaction action;
    memset(&action, 0, sizeof action);
    action.sa_handler = handle_switch_signal;
    sigaction(SIGUSR1, &action, NULL);
    sigaction(SIGUSR2, &action, NULL);
  }
}
