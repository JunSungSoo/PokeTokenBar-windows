import { parseMacJSON } from '../companion/mac-profile.js';
import { randomInt, randomUUID } from 'node:crypto';
import { createConnection, createServer, isIPv4, type Server, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { TradeState } from '../../shared/trade.js';
import { playerProfile, profileIcon } from '../../shared/player-profile.js';
import type { CompanionView } from '../../shared/companion.js';
import type { CompanionStore } from '../companion/store.js';
import { object, type Row } from '../usage/jsonl.js';
import { readTradeItem, tradeLabel, tradePreview, wireItem, type OfferedItem } from './item.js';

const limit = 1024 * 1024;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function localIPv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function tradeFrame(message: Row): Buffer {
  const bytes = Buffer.from(JSON.stringify(message));
  if (bytes.length > limit) throw new Error('교환 메시지가 너무 큽니다.');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  return Buffer.concat([header, bytes]);
}

export class LanTrade {
  private server?: Server;
  private socket?: Socket;
  private buffer = Buffer.alloc(0);
  private session = randomUUID();
  private code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
  private mine?: OfferedItem;
  private theirs?: OfferedItem;
  private peerAccepted = false;
  private localSaved = false;
  private remoteSaved = false;
  private preparing = false;
  private committing = false;
  private review = 0;
  private approvalTimer?: ReturnType<typeof setTimeout>;
  private snapshot: TradeState = { phase: 'idle', codes: [], accepted: false, canAccept: false, message: '' };

  constructor(private readonly store: CompanionStore, private readonly changed: (state: TradeState) => void,
    private readonly saved: (companion: CompanionView) => void) {}

  state(): TradeState { return this.snapshot; }
  blocksUpdate(): boolean {
    return this.preparing || this.committing || ['waiting', 'connected', 'committing'].includes(this.snapshot.phase);
  }
  choices() { return this.store.tradeChoices(); }

  private show(values: Partial<TradeState>): void {
    this.snapshot = { ...this.snapshot, ...values };
    this.snapshot.canAccept = this.snapshot.phase === 'connected' && !this.preparing &&
      !this.snapshot.accepted && !!this.mine && !!this.theirs;
    this.changed(this.snapshot);
  }

  private reset(nickname: string, icon?: number): void {
    if (this.committing || this.preparing) throw new Error('교환 확정이 진행 중입니다.');
    this.close();
    this.session = randomUUID();
    this.snapshot = { phase: 'waiting', codes: [], accepted: false, canAccept: false, message: '연결 대기 중…',
      localProfile: playerProfile(nickname, icon) };
    this.mine = this.theirs = undefined;
    this.peerAccepted = this.localSaved = this.remoteSaved = false;
    this.buffer = Buffer.alloc(0);
    this.review++;
    this.show({});
  }

  async host(nickname: string, icon?: number): Promise<void> {
    this.reset(nickname, icon);
    const server = createServer(socket => {
      const address = socket.remoteAddress ?? '';
      if (!localIPv4(address) || this.server !== server || this.socket) { socket.destroy(); return; }
      server.close();
      this.server = undefined;
      this.wire(socket, true);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
    }).catch(error => {
      if (this.server === server) this.close('LAN에서 연결을 받을 수 없습니다.');
      throw error;
    });
    if (this.server !== server) { server.close(); return; }
    server.on('error', () => this.close('LAN에서 연결을 받을 수 없습니다.'));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('LAN 포트를 열 수 없습니다.');
    const addresses = Object.values(networkInterfaces()).flat().filter(item =>
      item?.family === 'IPv4' && !item.internal && localIPv4(item.address)).map(item => item!.address);
    this.show({ codes: [...new Set(addresses.length ? addresses : ['127.0.0.1'])].map(ip => ip + ':' + address.port) });
  }

  connect(code: string, nickname: string, icon?: number): void {
    const [address, port, extra] = code.trim().split(':');
    if (extra !== undefined || !localIPv4(address) || !/^\d{1,5}$/.test(port ?? '') || +port < 1 || +port > 65535) {
      throw new Error('같은 LAN의 IPv4:포트 연결 코드를 입력해 주세요.');
    }
    this.reset(nickname, icon);
    this.wire(createConnection({ host: address, port: +port, family: 4 }), false);
  }

  private wire(socket: Socket, ready: boolean): void {
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(10000);
    const hello = () => {
      if (this.socket !== socket) return;
      this.send({ hello: { ...this.snapshot.localProfile, code: this.code } });
      this.show({ codes: [], message: '상대 앱을 확인하는 중…' });
    };
    socket.on('timeout', () => { if (this.socket === socket) this.close('연결 시간이 초과되었습니다.'); });
    socket.on('error', () => { if (this.socket === socket) this.close('LAN 연결에 실패했습니다.'); });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      if (this.snapshot.phase === 'complete') this.socket = undefined;
      else this.close();
    });
    socket.on('data', bytes => {
      if (this.socket !== socket) return;
      try {
        this.buffer = Buffer.concat([this.buffer, bytes]);
        while (this.buffer.length >= 4 && this.socket === socket) {
          const size = this.buffer.readUInt32BE();
          if (!size || size > limit) throw new Error('잘못된 메시지 크기');
          if (this.buffer.length < size + 4) break;
          const text = new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(4, size + 4));
          this.buffer = this.buffer.subarray(size + 4);
          this.receive(parseMacJSON(text));
        }
      } catch {
        this.close('상대의 교환 메시지를 확인할 수 없습니다.');
      }
    });
    if (ready) hello();
    else socket.once('connect', hello);
  }

  private send(message: Row): void {
    if (!this.socket?.writable || this.socket.destroyed) throw new Error('상대 앱과 연결되어 있지 않습니다.');
    this.socket.write(tradeFrame(message));
  }

  async offer(id: string): Promise<void> {
    if (this.snapshot.phase !== 'connected' || this.snapshot.accepted || this.preparing) {
      throw new Error('현재 제안을 변경할 수 없습니다.');
    }
    const session = this.session;
    const item = await this.store.tradeOffer(id);
    if (session !== this.session || this.snapshot.phase !== 'connected' ||
        this.snapshot.accepted || this.preparing) throw new Error('교환 상태가 변경되었습니다.');
    this.send({ offer: { _0: wireItem(item) } });
    this.mine = item;
    this.peerAccepted = false;
    this.review++;
    this.show({ mine: tradeLabel(item), mineItem: tradePreview(item), message: this.theirs ? '두 개체를 확인한 뒤 확정해 주세요.' : '상대의 제안을 기다리는 중…' });
  }

  withdraw(): void {
    if (this.snapshot.phase !== 'connected' || this.preparing) throw new Error('현재 제안을 변경할 수 없습니다.');
    this.send({ offerWithdrawn: {} });
    this.mine = undefined;
    this.peerAccepted = false;
    this.review++;
    clearTimeout(this.approvalTimer);
    this.store.releaseTrade(this.session);
    this.show({mine:undefined,mineItem:undefined,accepted:false,backupPath:undefined,message:'교환할 대상 선택'});
  }

  reject(): void {
    if (this.committing || this.preparing) throw new Error('교환 확정이 진행 중입니다.');
    if (this.snapshot.phase === 'connected') this.send({reject:{reason:'user_declined'}});
    this.close('교환을 취소했습니다.');
  }

  async accept(replaceCurrent = false): Promise<void> {
    const sent = this.mine;
    const received = this.theirs;
    if (!this.snapshot.canAccept || !sent || !received) throw new Error('양쪽 제안을 먼저 확인해 주세요.');
    const session = this.session;
    const review = this.review;
    this.preparing = true;
    this.show({});
    try {
      const backup = await this.store.prepareTrade(session, sent, received, replaceCurrent);
      if (this.session !== session || this.review !== review || this.snapshot.phase !== 'connected') {
        this.store.releaseTrade(session);
        return;
      }
      this.send({ accept: {} });
      this.show({ accepted: true, backupPath: backup, message: '상대의 확정을 기다리는 중…' });
      this.approvalTimer = setTimeout(() => this.close('확정 대기 시간이 지나 교환을 종료했습니다.'), 120000);
      this.commitIfReady();
    } catch (error) {
      this.store.releaseTrade(session);
      throw error;
    } finally {
      this.preparing = false;
      this.show({});
    }
  }

  private receive(value: unknown): void {
    const message = object(value);
    const keys = Object.keys(message ?? {});
    const kind = keys[0];
    const payload = object(message?.[kind]);
    if (keys.length !== 1 || !payload) throw new Error('잘못된 교환 메시지');
    if (kind === 'hello' && this.snapshot.phase === 'waiting') {
      if (typeof payload.nickname !== 'string' || typeof payload.code !== 'string') throw new Error('잘못된 상대 정보');
      this.socket?.setTimeout(600000);
      this.show({ phase: 'connected', peer: payload.nickname.slice(0, 60) + ' (' + payload.code.slice(0, 24) + ')',
        peerProfile: { nickname: payload.nickname.slice(0, 60), icon: profileIcon(payload.icon) },
        message: '보낼 포켓몬을 제안해 주세요.' });
      return;
    }
    if (this.snapshot.phase === 'waiting') throw new Error('상대 정보가 없습니다.');
    if (kind === 'offer' || kind === 'offerWithdrawn') {
      if (this.committing || this.localSaved) return;
      this.theirs = kind === 'offer' ? readTradeItem(payload._0) : undefined;
      clearTimeout(this.approvalTimer);
      this.store.releaseTrade(this.session);
      this.peerAccepted = false;
      this.review++;
      this.show({ theirs: this.theirs && tradeLabel(this.theirs), theirItem:this.theirs && tradePreview(this.theirs),
        accepted:false,backupPath:undefined,message: this.mine && this.theirs ? '두 개체를 확인한 뒤 확정해 주세요.' : '상대의 제안을 기다리는 중…' });
    } else if (kind === 'accept' && this.mine && this.theirs) {
      this.peerAccepted = true;
      this.commitIfReady();
    } else if (kind === 'commitAck' && this.peerAccepted && this.snapshot.accepted) {
      this.remoteSaved = true;
      this.completeIfReady();
    } else if (kind === 'reject') {
      this.close('상대가 교환을 취소했습니다.');
    }
  }

  private commitIfReady(): void {
    if (!this.snapshot.accepted || !this.peerAccepted || this.committing || this.localSaved || !this.mine || !this.theirs) return;
    clearTimeout(this.approvalTimer);
    this.committing = true;
    this.show({ phase: 'committing', message: '교환 결과를 저장하는 중…' });
    const session = this.session;
    try { this.send({ commit: { nonce: session } }); } catch { /* the local commit is already decided */ }
    void this.store.commitTrade(session, this.mine, this.theirs).then(companion => {
      this.localSaved = true;
      this.saved(companion);
      if (this.socket) this.send({ commitAck: { nonce: session } });
      this.completeIfReady();
      if (this.socket && !this.remoteSaved) {
        this.approvalTimer = setTimeout(() => this.close(), 30000);
      }
      if (!this.socket) this.show({ phase: 'closed', message: '내 저장은 완료됐지만 상대의 저장은 확인하지 못했습니다. 교환 전 백업을 확인해 주세요.' });
    }).catch(() => {
      this.close(this.localSaved ? '내 저장은 완료됐지만 상대의 저장은 확인하지 못했습니다.'
        : '내 교환 결과를 저장하지 못했습니다. 상대의 저장 여부를 확인해 주세요.');
    }).finally(() => {
      this.committing = false;
      this.store.releaseTrade(session);
    });
  }

  private completeIfReady(): void {
    if (!this.localSaved || !this.remoteSaved) return;
    clearTimeout(this.approvalTimer);
    this.show({ phase: 'complete', message: '양쪽 앱에 교환 결과가 저장되었습니다.' });
    this.socket?.end();
  }

  close(message?: string): void {
    clearTimeout(this.approvalTimer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
    const server = this.server;
    this.server = undefined;
    if (server?.listening) server.close();
    if (!this.committing) this.store.releaseTrade(this.session);
    if (this.snapshot.phase === 'idle' || this.snapshot.phase === 'complete') return;
    this.show({ phase: 'closed', codes: [], message: message ?? (this.localSaved
      ? '내 저장은 완료됐지만 상대의 저장은 확인하지 못했습니다. 교환 전 백업을 확인해 주세요.'
      : '교환 연결이 종료되었습니다.') });
  }

  async prepareHandoff():Promise<void>{
    this.close();const deadline=Date.now()+10000;
    while(this.preparing||this.committing){if(Date.now()>deadline)throw new Error('교환 저장을 마친 뒤 새 버전으로 전환할 수 있습니다.');await new Promise(r=>setTimeout(r,20));}
  }
}
