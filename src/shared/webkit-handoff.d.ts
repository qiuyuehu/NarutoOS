declare module '*webkit-handoff.cjs' {
  import { CookiesSetDetails } from 'electron';
  import { ChildProcess } from 'child_process';
  export function allowedDomain(domain: string): boolean;
  export function validateHandoff(event: unknown, fixture?: string): { url: string; cookies: CookiesSetDetails[] };
  export function cookieDetails(records: unknown[], fixture?: string): CookiesSetDetails[];
  export function startLogin(binary: string, options?: {
    fixture?: string; production?: boolean; visible?: boolean; initialCookies?: unknown[]; timeout?: number;
    onSnapshot?: (cookies: CookiesSetDetails[]) => Promise<void>; onReady?: () => void; onBlocked?: () => void;
  }): { result: Promise<{ url: string; cookies: CookiesSetDetails[] }>; cancel: () => void; focus: () => void; child: ChildProcess };
}
