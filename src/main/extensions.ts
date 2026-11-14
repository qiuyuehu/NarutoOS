import { EventEmitter } from 'events';
import { LoadState } from '../shared/model';
// A small in-process seam for future game assistance; no plugin loader or speed control.
export interface GameContext { id: string; state: LoadState; refresh(): void; setMuted(value: boolean): void }
export class GameLifecycle extends EventEmitter {
  opened(context: GameContext) { this.emit('opened', context); }
  changed(context: GameContext) { this.emit('changed', context); }
  closed(id: string) { this.emit('closed', id); }
}
