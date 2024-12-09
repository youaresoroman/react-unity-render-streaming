import * as Logger from "./utils";

export class Peer extends EventTarget {
  private connectionId: string | null;
  private polite: boolean;
  private config: RTCConfiguration;
  private pc: RTCPeerConnection | null;
  private makingOffer: boolean;
  private waitingAnswer: boolean;
  private ignoreOffer: boolean;
  private srdAnswerPending: boolean;
  private interval: number;
  private sleep: (msec: number) => Promise<void>;
  private log: (str: string) => void;
  private warn: (str: string) => void;
  private assert_equals: (a: any, b: any, msg: string) => void;

  constructor(connectionId: string, polite: boolean, config: RTCConfiguration, resendIntervalMsec: number = 5000) {
    super();
    this.connectionId = connectionId;
    this.polite = polite;
    this.config = config;
    this.pc = new RTCPeerConnection(this.config);
    this.makingOffer = false;
    this.waitingAnswer = false;
    this.ignoreOffer = false;
    this.srdAnswerPending = false;
    this.log = (str: string) => Logger.log(`[${this.polite ? 'POLITE' : 'IMPOLITE'}] ${str}`);
    this.warn = (str: string) => Logger.warn(`[${this.polite ? 'POLITE' : 'IMPOLITE'}] ${str}`);
    this.assert_equals = (a: any, b: any, msg: string) => { if (a === b) { return; } throw new Error(`${msg} expected ${b} but got ${a}`); };
    this.interval = resendIntervalMsec;
    this.sleep = (msec: number) => new Promise(resolve => setTimeout(resolve, msec));

    this.pc.ontrack = (e: RTCTrackEvent) => {
      this.log(`ontrack:${e}`);
      this.dispatchEvent(new CustomEvent('trackevent', { detail: e }));
    };
    this.pc.ondatachannel = (e: RTCDataChannelEvent) => {
      this.log(`ondatachannel:${e}`);
      this.dispatchEvent(new CustomEvent('adddatachannel', { detail: e }));
    };
    this.pc.onicecandidate = ({ candidate }: RTCPeerConnectionIceEvent) => {
      this.log(`send candidate:${candidate}`);
      if (candidate == null) {
        return;
      }
      this.dispatchEvent(new CustomEvent('sendcandidate', { detail: { connectionId: this.connectionId, candidate: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid } }));
    };

    this.pc.onnegotiationneeded = this._onNegotiation.bind(this);

    this.pc.onsignalingstatechange = () => {
      this.log(`signalingState changed:${this.pc?.signalingState}`);
    };

    this.pc.oniceconnectionstatechange = () => {
      this.log(`iceConnectionState changed:${this.pc?.iceConnectionState}`);
      if (this.pc?.iceConnectionState === 'disconnected') {
        this.dispatchEvent(new Event('disconnect'));
      }
    };

    this.pc.onicegatheringstatechange = () => {
      this.log(`iceGatheringState changed:${this.pc?.iceGatheringState}'`);
    };

    this.loopResendOffer();
  }

  private async _onNegotiation() {
    try {
      this.log(`SLD due to negotiationneeded`);
      this.assert_equals(this.pc?.signalingState, 'stable', 'negotiationneeded always fires in stable state');
      this.assert_equals(this.makingOffer, false, 'negotiationneeded not already in progress');
      this.makingOffer = true;
      await this.pc?.setLocalDescription();
      this.assert_equals(this.pc?.signalingState, 'have-local-offer', 'negotiationneeded not racing with onmessage');
      this.assert_equals(this.pc?.localDescription?.type, 'offer', 'negotiationneeded SLD worked');
      this.waitingAnswer = true;
      this.dispatchEvent(new CustomEvent('sendoffer', { detail: { connectionId: this.connectionId, sdp: this.pc?.localDescription?.sdp } }));
    } catch (e) {
      this.log(JSON.stringify(e));
    } finally {
      this.makingOffer = false;
    }
  }

  private async loopResendOffer() {
    while (this.connectionId) {
      if (this.pc && this.waitingAnswer) {
        this.dispatchEvent(new CustomEvent('sendoffer', { detail: { connectionId: this.connectionId, sdp: this.pc?.localDescription?.sdp } }));
      }
      await this.sleep(this.interval);
    }
  }

  public close() {
    this.connectionId = null;
    if (this.pc) {
      this.pc?.close();
      this.pc = null;
    }
  }

  public getTransceivers(connectionId: string | null) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc?.getTransceivers();
  }

  public addTrack(connectionId: string | null, track: MediaStreamTrack) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc?.addTrack(track);
  }

  public addTransceiver(connectionId: string | null, trackOrKind: MediaStreamTrack | string, init?: RTCRtpTransceiverInit) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc?.addTransceiver(trackOrKind, init);
  }

  public createDataChannel(connectionId: string | null, label: string) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc?.createDataChannel(label);
  }

  public async getStats(connectionId: string | null) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return await this.pc?.getStats();
  }

  public async onGotDescription(connectionId: string, description: RTCSessionDescriptionInit) {
    if (this.connectionId !== connectionId) {
      return;
    }

    const isStable =
      this.pc?.signalingState === 'stable' ||
      (this.pc?.signalingState === 'have-local-offer' && this.srdAnswerPending);
    this.ignoreOffer =
      description.type === 'offer' && !this.polite && (this.makingOffer || !isStable);

    if (this.ignoreOffer) {
      this.log(`glare - ignoring offer`);
      return;
    }

    this.waitingAnswer = false;
    this.srdAnswerPending = description.type === 'answer';
    this.log(`SRD(${description.type})`);
    await this.pc?.setRemoteDescription(description);
    this.srdAnswerPending = false;

    if (description.type === 'offer') {
      this.dispatchEvent(new CustomEvent('ongotoffer', { detail: { connectionId: this.connectionId } }));

      this.assert_equals(this.pc?.signalingState, 'have-remote-offer', 'Remote offer');
      this.assert_equals(this.pc?.remoteDescription?.type, 'offer', 'SRD worked');
      this.log('SLD to get back to stable');
      await this.pc?.setLocalDescription();
      this.assert_equals(this.pc?.signalingState, 'stable', 'onmessage not racing with negotiationneeded');
      this.assert_equals(this.pc?.localDescription?.type, 'answer', 'onmessage SLD worked');
      this.dispatchEvent(new CustomEvent('sendanswer', { detail: { connectionId: this.connectionId, sdp: this.pc?.localDescription?.sdp } }));

    } else {
      this.dispatchEvent(new CustomEvent('ongotanswer', { detail: { connectionId: this.connectionId } }));

      this.assert_equals(this.pc?.remoteDescription?.type, 'answer', 'Answer was set');
      this.assert_equals(this.pc?.signalingState, 'stable', 'answered');
      this.pc?.dispatchEvent(new Event('negotiated'));
    }
  }

  public async onGotCandidate(connectionId: string, candidate: RTCIceCandidateInit) {
    if (this.connectionId !== connectionId) {
      return;
    }

    try {
      await this.pc?.addIceCandidate(candidate);
    } catch (e) {
      if (this.pc && !this.ignoreOffer)
        this.warn(`${this.pc} this candidate can't accept current signaling state ${this.pc?.signalingState}.`);
    }
  }
}
