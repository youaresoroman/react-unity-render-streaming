import * as Logger from "./utils";

interface Message {
  type: string;
  from?: string;
  data?: any;
}

interface Session {
  sessionId: string;
}

export class Signaling extends EventTarget {
  private running: boolean;
  private interval: number;
  private sleep: (msec: number) => Promise<void>;
  private sessionId?: string | null;

  constructor(interval = 1000) {
    super();
    this.running = false;
    this.interval = interval;
    this.sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));
  }

  private headers(): HeadersInit {
    if (this.sessionId !== undefined && this.sessionId !== null) {
      return { 'Content-Type': 'application/json', 'Session-Id': this.sessionId };
    } else {
      return { 'Content-Type': 'application/json' };
    }
  }

  private url(method: string, parameter = ''): string {
    let ret = location.origin + '/signaling';
    if (method) ret += '/' + method;
    if (parameter) ret += '?' + parameter;
    return ret;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    while (!this.sessionId) {
      const createResponse = await fetch(this.url(''), { method: 'PUT', headers: this.headers() });
      const session: Session = await createResponse.json();
      this.sessionId = session.sessionId;

      if (!this.sessionId) {
        await this.sleep(this.interval);
      }
    }

    this.loopGetAll();
  }

  private async loopGetAll(): Promise<void> {
    let lastTimeRequest = Date.now() - 30000;
    while (this.running) {
      const res = await this.getAll(lastTimeRequest);
      const data = await res.json();
      lastTimeRequest = data.datetime ? data.datetime : Date.now();

      const messages: Message[] = data.messages;

      for (const msg of messages) {
        switch (msg.type) {
          case "connect":
            break;
          case "disconnect":
            this.dispatchEvent(new CustomEvent('disconnect', { detail: msg }));
            break;
          case "offer":
            this.dispatchEvent(new CustomEvent('offer', { detail: msg }));
            break;
          case "answer":
            this.dispatchEvent(new CustomEvent('answer', { detail: msg }));
            break;
          case "candidate":
            this.dispatchEvent(new CustomEvent('candidate', { detail: msg }));
            break;
          default:
            break;
        }
      }
      await this.sleep(this.interval);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await fetch(this.url(''), { method: 'DELETE', headers: this.headers() });
    this.sessionId = null;
  }

  async createConnection(connectionId: string): Promise<any> {
    const data = { connectionId };
    const res = await fetch(this.url('connection'), { method: 'PUT', headers: this.headers(), body: JSON.stringify(data) });
    const json = await res.json();
    Logger.log(`Signaling: HTTP create connection, connectionId: ${json.connectionId}, polite:${json.polite}`);

    this.dispatchEvent(new CustomEvent('connect', { detail: json }));
    return json;
  }

  async deleteConnection(connectionId: string | null): Promise<any> {
    if (!connectionId) {
      return;
    }
    const data = { connectionId };
    const res = await fetch(this.url('connection'), { method: 'DELETE', headers: this.headers(), body: JSON.stringify(data) });
    const json = await res.json();
    this.dispatchEvent(new CustomEvent('disconnect', { detail: json }));
    return json;
  }

  async sendOffer(connectionId: string, sdp: string): Promise<void> {
    const data = { sdp, connectionId };
    Logger.log('sendOffer:' + JSON.stringify(data));
    await fetch(this.url('offer'), { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
  }

  async sendAnswer(connectionId: string, sdp: string): Promise<void> {
    const data = { sdp, connectionId };
    Logger.log('sendAnswer:' + JSON.stringify(data));
    await fetch(this.url('answer'), { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
  }

  async sendCandidate(connectionId: string, candidate: string, sdpMLineIndex: number, sdpMid: string): Promise<void> {
    const data = { candidate, sdpMLineIndex, sdpMid, connectionId };
    Logger.log('sendCandidate:' + JSON.stringify(data));
    await fetch(this.url('candidate'), { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
  }

  async getAll(fromTime = 0): Promise<Response> {
    return await fetch(this.url('', `fromtime=${fromTime}`), { method: 'GET', headers: this.headers() });
  }
}

export class WebSocketSignaling extends EventTarget {
  private interval: number;
  private sleep: (msec: number) => Promise<void>;
  private websocket: WebSocket;
  private isWsOpen: boolean = false;
  private connectionId: string | null;

  constructor(interval = 1000) {
    super();
    this.interval = interval;
    this.sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

    let websocketUrl;
    if (location.protocol === "https:") {
      websocketUrl = "wss://" + location.host;
    } else {
      websocketUrl = "ws://" + location.host;
    }

    this.websocket = new WebSocket(websocketUrl);
    this.connectionId = null;

    this.websocket.onopen = () => {
      this.isWsOpen = true;
    };

    this.websocket.onclose = () => {
      this.isWsOpen = false;
    };

    this.websocket.onmessage = (event) => {
      const msg: Message = JSON.parse(event.data);
      if (!msg || !this) {
        return;
      }

      Logger.log(msg);

      switch (msg.type) {
        case "connect":
          this.dispatchEvent(new CustomEvent('connect', { detail: msg }));
          break;
        case "disconnect":
          this.dispatchEvent(new CustomEvent('disconnect', { detail: msg }));
          break;
        case "offer":
          this.dispatchEvent(new CustomEvent('offer', { detail: { connectionId: msg.from, sdp: msg.data.sdp, polite: msg.data.polite } }));
          break;
        case "answer":
          this.dispatchEvent(new CustomEvent('answer', { detail: { connectionId: msg.from, sdp: msg.data.sdp } }));
          break;
        case "candidate":
          this.dispatchEvent(new CustomEvent('candidate', { detail: { connectionId: msg.from, candidate: msg.data.candidate, sdpMLineIndex: msg.data.sdpMLineIndex, sdpMid: msg.data.sdpMid } }));
          break;
        default:
          break;
      }
    };
  }

  async start(): Promise<void> {
    while (!this.isWsOpen) {
      await this.sleep(100);
    }
  }

  async stop(): Promise<void> {
    this.websocket.close();
    while (this.isWsOpen) {
      await this.sleep(100);
    }
  }

  createConnection(connectionId: string): void {
    const sendJson = JSON.stringify({ type: "connect", connectionId });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  deleteConnection(connectionId: string): void {
    const sendJson = JSON.stringify({ type: "disconnect", connectionId });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  sendOffer(connectionId: string, sdp: string): void {
    const data = { sdp, connectionId };
    const sendJson = JSON.stringify({ type: "offer", from: connectionId, data });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  sendAnswer(connectionId: string, sdp: string): void {
    const data = { sdp, connectionId };
    const sendJson = JSON.stringify({ type: "answer", from: connectionId, data });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  sendCandidate(connectionId: string, candidate: string, sdpMLineIndex: number, sdpMid: string): void {
    const data = { candidate, sdpMLineIndex, sdpMid, connectionId };
    const sendJson = JSON.stringify({ type: "candidate", from: connectionId, data });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }
}
