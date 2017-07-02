﻿import { EventEmitter } from "events";
import * as dgram from "dgram";
import { RecordLayer } from "./DTLS/RecordLayer";
import { Message } from "./TLS/Message";
import { ContentType } from "./TLS/ContentType";
import { ClientHandshakeHandler, HandshakeStates } from "./DTLS/HandshakeHandler";
import { FragmentedHandshake } from "./DTLS/Handshake";
import { ChangeCipherSpec } from "./TLS/ChangeCipherSpec";
import { TLSStruct } from "./TLS/TLSStruct";
//import { DTLSPlaintext } from "./DTLS/DTLSPlaintext";
//import { DTLSCompressed } from "./DTLS/DTLSCompressed";
//import { DTLSCiphertext } from "./DTLS/DTLSCiphertext";

export module dtls {

	/**
	 * Creates a DTLS-secured socket.
	 * @param options - The options used to create the socket
	 * @param callback - If provided, callback is bound to the "message" event
	 */
	export function createSocket(options: Options, callback?: MessageEventHandler): Socket {
		const ret = new Socket(options);
		// TODO: only bind "message" event after the handshake is finished
		if (callback != null) ret.on("message", callback);
		return ret;
	}

	/**
	 * DTLS-secured UDP socket. Can be used as a drop-in replacement for dgram.Socket
	 */
	export class Socket extends EventEmitter {

		/**
		 * INTERNAL USE, DON'T CALL DIRECTLY. use createSocket instead!
		 */
		constructor(private options: Options) {
			super();
			// setup the connection
			this.udp = dgram
				.createSocket(options, this.udp_onMessage)
				.on("listening", this.udp_onListening)
				.on("message", this.udp_onMessage)
				.on("close", this.udp_onClose)
				.on("error", this.udp_onError)
				;
		}

		private recordLayer: RecordLayer;
		private handshakeHandler: ClientHandshakeHandler;

		/**
		 * Send the given data. It is automatically compressed and encrypted.
		 */
		send(data: Buffer, callback?: SendCallback) {

			if (this._isClosed) {
				throw new Error("the socket is closed. cannot send data.");
			}

			// send finished data over UDP
			const packet: Message = {
				type: ContentType.application_data,
				data: data
			};

			this.recordLayer.send(packet, callback);
		}

		close(callback?: CloseEventHandler) {
			if (callback) this.on("close", callback);
			this.udp.close();
		}

		// buffer messages while handshaking
		private bufferedMessages: {msg: Message, rinfo: dgram.RemoteInfo}[] = [];

		/*
			Internal Socket handler functions
		*/
		private udp: dgram.Socket;

		private udp_onListening() {
			// initialize record layer
			this.recordLayer = new RecordLayer(this.udp, this.options);
			// also start handshake
			this.handshakeHandler = new ClientHandshakeHandler(this.recordLayer, () => {
				// when done, emit "connected" event
				this.emit("connected");
				// also emit all buffered messages
				while (this.bufferedMessages.length > 0) {
					let {msg, rinfo} = this.bufferedMessages.shift();
					this.emit("message", msg, rinfo);
				}
			});
		}

		private udp_onMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
			// decode the messages
			const messages = this.recordLayer.receive(msg);

			// TODO: only for handshake messages, if they are received out of sequence,
			// buffer them up and serve them with the next batch of messages
			// also implement retransmission.
			for (let msg of messages) {
				switch (msg.type) {
					case ContentType.handshake:
						const handshake = TLSStruct.from(FragmentedHandshake.spec, msg.data).result as FragmentedHandshake;
						this.handshakeHandler.processMessage(handshake);
						break;
					case ContentType.change_cipher_spec:
						this.handshakeHandler.changeCipherSpec();
						break;
					case ContentType.alert:
						// TODO: read spec to see how we handle this
						break;

					case ContentType.application_data:
						if (this.handshakeHandler.state !== HandshakeStates.finished) {
							// if we are still shaking hands, buffer the message until we're done
							this.bufferedMessages.push({msg, rinfo});
						} else /* finished */ {
							// else emit the message
							// TODO: extend params?
							// TODO: do we need to emit rinfo?
							this.emit("message", msg, rinfo);
						}
						break;
				}
			}
		}

		private _isClosed: boolean = false;
		private udp_onClose() {
			this._isClosed = true;
			this.emit("close");
		}
		private udp_onError(exception: Error) {
			this.emit("error", exception);
		}
		
	}

	export interface Options {
		type: "udp4" | "udp6";
		reuseAddr: boolean;
		address: string;
		port: number;
		keyContext: any; // TODO: DTLS-security options
	}

	export type ListeningEventHandler = () => void;
	export type MessageEventHandler = (msg: Buffer, rinfo: dgram.RemoteInfo) => void;
	export type CloseEventHandler = () => void;
	export type ErrorEventHandler = (exception: Error) => void;
	export type SendCallback = (error: Error, bytes: number) => void;
}
