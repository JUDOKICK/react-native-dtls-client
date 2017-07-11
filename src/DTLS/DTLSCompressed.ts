﻿import * as TypeSpecs from "../TLS/TypeSpecs";
import { TLSStruct } from "../TLS/TLSStruct";
import { ProtocolVersion } from "../TLS/ProtocolVersion";
import { ContentType } from "../TLS/ContentType";
import { DTLSPlaintext } from "./DTLSPlaintext";
import { DTLSPacket } from "./DTLSPacket";

export class DTLSCompressed extends TLSStruct implements DTLSPacket {

	static readonly __spec = {
		type: ContentType.__spec,
		version: TypeSpecs.define.Struct(ProtocolVersion),
		epoch: TypeSpecs.uint16,
		sequence_number: TypeSpecs.uint48,
		// length field is implied in the variable length vector //length: new TypeSpecs.Calculated("uint16", "serializedLength", "fragment"),
		fragment: TypeSpecs.define.Buffer(0, 1024 + 2 ** 14)
	};
	static readonly spec = TypeSpecs.define.Struct(DTLSCompressed);

	constructor(
		public type: ContentType,
		public version = new ProtocolVersion(),
		public epoch: number,
		public sequence_number: number,
		public fragment: Buffer
	) {
		super(DTLSCompressed.__spec);
	}

	static createEmpty(): DTLSCompressed {
		return new DTLSCompressed(null, null, null, null, null);
	}

	/**
	 * Compresses the given plaintext packet
	 * @param packet - The plaintext packet to be compressed
	 * @param compressor - The compressor function used to compress the given packet
	 */
	static compress(packet: DTLSPlaintext, compressor: CompressorDelegate) : DTLSCompressed {
		return new DTLSCompressed(
			packet.type,
			packet.version,
			packet.epoch,
			packet.sequence_number,
			compressor(packet.fragment)
		);
	}
	
	/**
	 * Decompresses this packet into a plaintext packet
	 * @param decompressor - The decompressor function used to decompress this packet
	 */
	decompress(decompressor: DecompressorDelegate) : DTLSPlaintext {
		return new DTLSPlaintext(
			this.type,
			this.version,
			this.epoch,
			this.sequence_number,
			decompressor(this.fragment) // TODO: handle decompression errors (like too large fragments)
		);
	}
	
	/**
	 * Computes the MAC header representing this packet. The MAC header is the input buffer of the MAC calculation minus the actual fragment buffer.
	 */
	computeMACHeader(): Buffer {
		return (new MACHeader(
			this.epoch,
			this.sequence_number,
			this.type,
			this.version,
			this["length"]
		)).serialize();
	}

}

export type CompressorDelegate = (plaintext: Buffer) => Buffer;
export type DecompressorDelegate = (compressed: Buffer) => Buffer;


export class MACHeader extends TLSStruct {

	static readonly __spec = {
		epoch: TypeSpecs.uint16,
		sequence_number: TypeSpecs.uint48,
		type: ContentType.__spec,
		version: TypeSpecs.define.Struct(ProtocolVersion),
		fragment_length: TypeSpecs.uint16
	};

	constructor(
		public epoch: number,
		public sequence_number: number,
		public type: ContentType,
		public version: ProtocolVersion,
		public fragment_length: number
	) {
		super(MACHeader.__spec);
	}

	static createEmpty(): MACHeader {
		return new MACHeader(null, null, null, null, null);
	}

}