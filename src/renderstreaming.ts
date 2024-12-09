import { Peer } from "./peer";
import * as Logger from "./utils";
import { Signaling } from "./signaling";

function uuid4() {
  var temp_url = URL.createObjectURL(new Blob());
  var uuid = temp_url.toString();
  URL.revokeObjectURL(temp_url);
  const parts = uuid.split(/[:/]/g);
  const lastPart = parts.pop();
  return lastPart ? lastPart.toLowerCase() : ''; // remove prefixes
}

export class RenderStreaming {
  private _peer: Peer | null;
  private _connectionId: string | null;
  private _config: RTCConfiguration;
  private _signaling: Signaling | null;

  public onConnect: (connectionId: string) => void;
  public onDisconnect: (connectionId: string) => void;
  public onGotOffer: (connectionId: string) => void;
  public onGotAnswer: (connectionId: string) => void;
  public onTrackEvent: (data: any) => void;
  public onAddChannel: (data: any) => void;

  /**
   * @param signaling signaling class
   * @param {RTCConfiguration} config
   */
  constructor(signaling: Signaling, config: RTCConfiguration) {
    this._peer = null;
    this._connectionId = null;
    this.onConnect = function (connectionId) { Logger.log(`Connect peer on ${connectionId}.`); };
    this.onDisconnect = function (connectionId) { Logger.log(`Disconnect peer on ${connectionId}.`); };
    this.onGotOffer = function (connectionId) { Logger.log(`On got Offer on ${connectionId}.`); };
    this.onGotAnswer = function (connectionId) { Logger.log(`On got Answer on ${connectionId}.`); };
    this.onTrackEvent = function (data) { Logger.log(`OnTrack event peer with data:${data}`); };
    this.onAddChannel = function (data) { Logger.log(`onAddChannel event peer with data:${data}`); };

    this._config = config;
    this._signaling = signaling;
    this._signaling.addEventListener('connect', this._onConnect.bind(this));
    this._signaling.addEventListener('disconnect', this._onDisconnect.bind(this));
    this._signaling.addEventListener('offer', this._onOffer.bind(this));
    this._signaling.addEventListener('answer', this._onAnswer.bind(this));
    this._signaling.addEventListener('candidate', this._onIceCandidate.bind(this));
  }

  private async _onConnect(e: Event) {
    const data = (e as CustomEvent).detail;
    if (this._connectionId == data.connectionId) {
      this._preparePeerConnection(this._connectionId, data.polite);
      this.onConnect(data.connectionId);
    }
  }

  private async _onDisconnect(e: Event) {
    const data = (e as CustomEvent).detail;
    if (this._connectionId == data.connectionId) {
      this.onDisconnect(data.connectionId);
      if (this._peer) {
        this._peer.close();
        this._peer = null;
      }
    }
  }

  private async _onOffer(e: Event) {
    const offer = (e as CustomEvent).detail;
    if (!this._peer) {
      this._preparePeerConnection(offer.connectionId, offer.polite);
    }
    const desc = new RTCSessionDescription({ sdp: offer.sdp, type: "offer" });
    try {
      await this._peer?.onGotDescription(offer.connectionId, desc);
    } catch (error) {
      Logger.warn(`Error happen on GotDescription that description.\n Message: ${error}\n RTCSdpType:${desc.type}\n sdp:${desc.sdp}`);
      return;
    }
  }

  private async _onAnswer(e: Event) {
    const answer = (e as CustomEvent).detail;
    const desc = new RTCSessionDescription({ sdp: answer.sdp, type: "answer" });
    if (this._peer) {
      try {
        await this._peer.onGotDescription(answer.connectionId, desc);
      } catch (error) {
        Logger.warn(`Error happen on GotDescription that description.\n Message: ${error}\n RTCSdpType:${desc.type}\n sdp:${desc.sdp}`);
        return;
      }
    }
  }

  private async _onIceCandidate(e: Event) {
    const candidate = (e as CustomEvent).detail;
    const iceCandidate = new RTCIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
    if (this._peer) {
      await this._peer.onGotCandidate(candidate.connectionId, iceCandidate);
    }
  }

  /**
   * if not set argument, a generated uuid is used.
   * @param {string | null} connectionId
   */
  async createConnection(connectionId?: string) {
    this._connectionId = connectionId ? connectionId : uuid4();
    await this._signaling?.createConnection(this._connectionId);
  }

  async deleteConnection() {
    await this._signaling?.deleteConnection(this._connectionId);
  }

  private _preparePeerConnection(connectionId: string | null, polite: boolean): Peer {
    if (!connectionId) {
      throw new Error('connectionId is required');
    }
    if (this._peer) {
      Logger.log('Close current PeerConnection');
      this._peer.close();
      this._peer = null;
    }

    // Create peerConnection with proxy server and set up handlers
    this._peer = new Peer(connectionId, polite, this._config);
    this._peer.addEventListener('disconnect', () => {
      this.onDisconnect(`Receive disconnect message from peer. connectionId:${connectionId}`);
    });
    this._peer.addEventListener('trackevent', (e: Event) => {
      const data = (e as CustomEvent).detail;
      this.onTrackEvent(data);
    });
    this._peer.addEventListener('adddatachannel', (e: Event) => {
      const data = (e as CustomEvent).detail;
      this.onAddChannel(data);
    });
    this._peer.addEventListener('ongotoffer', (e: Event) => {
      const id = (e as CustomEvent).detail.connectionId;
      this.onGotOffer(id);
    });
    this._peer.addEventListener('ongotanswer', (e: Event) => {
      const id = (e as CustomEvent).detail.connectionId;
      this.onGotAnswer(id);
    });
    this._peer.addEventListener('sendoffer', (e: Event) => {
      const offer = (e as CustomEvent).detail;
      this._signaling?.sendOffer(offer.connectionId, offer.sdp);
    });
    this._peer.addEventListener('sendanswer', (e: Event) => {
      const answer = (e as CustomEvent).detail;
      this._signaling?.sendAnswer(answer.connectionId, answer.sdp);
    });
    this._peer.addEventListener('sendcandidate', (e: Event) => {
      const candidate = (e as CustomEvent).detail;
      this._signaling?.sendCandidate(candidate.connectionId, candidate.candidate, candidate.sdpMid, candidate.sdpMLineIndex);
    });
    return this._peer;
  }

  /**
   * @returns {Promise<RTCStatsReport> | null}
   */
  async getStats(): Promise<RTCStatsReport | null> {
    return await this._peer?.getStats(this._connectionId) || null;
  }

  /**
   * @param {string} label
   * @returns {RTCDataChannel | null}
   */
  createDataChannel(label: string): RTCDataChannel | null {
    return this._peer?.createDataChannel(this._connectionId, label) || null;
  }

  /**
   * @param {MediaStreamTrack} track
   * @returns {RTCRtpSender | null}
   */
  addTrack(track: MediaStreamTrack): RTCRtpSender | null {
    return this._peer?.addTrack(this._connectionId, track) || null;
  }

  /**
   * @param {MediaStreamTrack | string} trackOrKind
   * @param {RTCRtpTransceiverInit | null} init
   * @returns {RTCRtpTransceiver | null}
   */
  addTransceiver(trackOrKind: MediaStreamTrack | string, init?: RTCRtpTransceiverInit): RTCRtpTransceiver | null {
    return this._peer?.addTransceiver(this._connectionId, trackOrKind, init) || null;
  }

  /**
   * @returns {RTCRtpTransceiver[] | null}
   */
  getTransceivers(): RTCRtpTransceiver[] | null {
    return this._peer?.getTransceivers(this._connectionId) || null;
  }

  async start() {
    await this._signaling?.start();
  }

  async stop() {
    if (this._peer) {
      this._peer.close();
      this._peer = null;
    }

    if (this._signaling) {
      await this._signaling.stop();
      this._signaling = null;
    }
  }
}
