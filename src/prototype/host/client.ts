import net from 'net';
import crypto from 'crypto';
export const root = process.env.NARUTO_C_ROOT!;
export const project = process.env.NARUTO_C_PROJECT!;
const token = process.env.NARUTO_C_TOKEN!;
export function core(command: string, payload: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
    const socket = net.createConnection(`/tmp/naruto-c-${process.getuid!()}-${hash}.sock`);
    let data = ''; let settled = false; const timer = setTimeout(() => { socket.destroy(); reject(new Error('核心连接超时')); }, 3000);
    socket.on('connect', () => socket.write(JSON.stringify({ v: 1, role: 'host', token, command, payload }) + '\n'));
    socket.on('data', bytes => {
      data += bytes; if (data.length > 262144) { socket.destroy(); reject(new Error('消息过大')); return; }
      if (!data.includes('\n')) return;
      try { const reply = JSON.parse(data.split('\n')[0]); if (!reply.ok) throw new Error(reply.message || '核心未接受请求'); settled=true;resolve(reply.value); } catch (error) { reject(error); }
      clearTimeout(timer); socket.end();
    });
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('close', () => {clearTimeout(timer);if (!settled) reject(new Error('核心连接已结束'));});
  });
}
