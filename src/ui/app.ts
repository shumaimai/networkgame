// 画面の切り替え、16:9 の固定ステージ、モーダル、セーブの読み書き
import { Game, Save, newSave } from '../game/state';
import { setVolume, sfx } from './audio';
import { mountBench } from './bench';
import { $, onAct } from './dom';
import { mountHub } from './hub';
import { mountShop } from './shop';
import { mountTitle } from './title';

const SAVE_KEY = 'netshop-save';
export const STAGE_W = 1920, STAGE_H = 1080;
export type ScreenId = 'title' | 'hub' | 'bench' | 'shop';
const SCREENS: Record<ScreenId, (app: App, root: HTMLElement) => () => void> = { title: mountTitle, hub: mountHub, bench: mountBench, shop: mountShop };

export class App {
  game!: Game;
  scale = 1;
  current: ScreenId = 'title';
  private stage = $('#stage');
  private screen = $('#screen');
  private overlay = $('#overlay');
  private unmount: (() => void) | null = null;
  private modalLocked = false;

  constructor() {
    this.load();
    this.fit();
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('contextmenu', e => e.preventDefault());
    this.overlay.addEventListener('pointerdown', e => { if (e.target === this.overlay && !this.modalLocked) this.closeModal(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !this.modalLocked && this.overlay.classList.contains('open')) this.closeModal(); });
    this.show('title');
  }

  hasSave(): boolean { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  private load(): void {
    let s: Save | null = null;
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (raw && raw.v === 2 && typeof raw.money === 'number') s = raw;
    } catch { /* 壊れたセーブは無視して最初から */ }
    this.setSave(s ?? newSave());
  }
  setSave(s: Save): void {
    this.game = new Game(s, x => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(x)); } catch { /* 保存できない環境でも遊べるようにする */ } });
    setVolume(s.settings.sfx);
  }
  newGame(): void { this.setSave(newSave()); this.game.save(); }

  private fit(): void {
    this.scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    this.stage.style.transform = `translate(-50%, -50%) scale(${this.scale})`;
  }
  stageRect(): DOMRect { return this.stage.getBoundingClientRect(); }

  show(id: ScreenId): void {
    this.unmount?.();
    this.closeModal();
    this.current = id;
    this.screen.className = 'screen s-' + id;
    this.screen.innerHTML = '';
    this.unmount = SCREENS[id](this, this.screen);
  }

  /** モーダルを開く。data-act="close" のボタンで閉じる */
  modal(html: string, opts: { wide?: boolean; locked?: boolean; cls?: string } = {}): HTMLElement {
    this.modalLocked = !!opts.locked;
    this.overlay.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''} ${opts.cls ?? ''}">${html}</div>`;
    this.overlay.classList.add('open');
    const box = this.overlay.firstElementChild as HTMLElement;
    onAct(box, act => { if (act === 'close') { sfx('click'); this.closeModal(); } });
    return box;
  }
  closeModal(): void {
    this.overlay.classList.remove('open');
    this.overlay.innerHTML = '';
    this.modalLocked = false;
    this.onModalClose?.();
    this.onModalClose = null;
  }
  onModalClose: (() => void) | null = null;

  toast(msg: string, cls = ''): void {
    const t = document.createElement('div');
    t.className = 'toast ' + cls;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
}
