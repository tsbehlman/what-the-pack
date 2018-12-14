module.exports = class MessagePack {
	constructor( size = Buffer.poolSize ) {
		this.reallocate( size );
		this.offset = 0;
		this.dictionary = new Map();
		this.dictionaryKeyIndex = -32;
		/* 
     * Why -32:
     * - This allows us to make use of the full fixint range(-32 to 127)
     * - That's 160 of your first keys being encoded in one byte instead of the whole string
     */
	}
	register( ...keys ) {
		for( const key of keys ) {
			this.dictionary.set( key, this.dictionaryKeyIndex );
			this.dictionary.set( this.dictionaryKeyIndex, key );
			this.dictionaryKeyIndex++;
		}
	}
  
	reallocate( length ) {
		this.buffer = Buffer.allocUnsafe( length ).fill( 0 );
	}
  
	encode( value, persist ) {
		if( persist !== true ) {
			this.offset = 0;
		}
		let length = 0;
		switch( typeof value ) {
		case "string":
			if( value.length < 16 ) {
				for( let i = 0, c = 0, l = value.length; i < l; i++ ) {
					c = value.charCodeAt( i );
					if( c < 0x80 ) {
						length += 1;
					}
					else if( c < 0x500 ) {
						length += 2;
					}
					else if( c < 0xD800 || c >= 0xE000 ) {
						length += 3;
					}
					else {
						i++;
						length += 4;
					}
				}
			}
			else {
				length = Buffer.byteLength( value );
			}
			if( length < 32 ) { // < 32, fixstr
				this.buffer[ this.offset++ ] = length | 160;
				for( let i = 0, c = 0, l = value.length; i < l; i++ ) {
					c = value.charCodeAt( i );
					if( c < 0x80 ) {
						this.buffer[ this.offset++ ] = c;
					}
					else if( c < 0x500 ) {
						this.buffer[ this.offset++ ] = 0xC0 | c >> 6        ;
						this.buffer[ this.offset++ ] = 0x80 | c       & 0x3F;
					}
					else if( c < 0xD800 || c >= 0xE000 ) {
						this.buffer[ this.offset++ ] = 0xE0 | c >> 12       ;
						this.buffer[ this.offset++ ] = 0x80 | c >> 6  & 0x3F;
						this.buffer[ this.offset++ ] = 0x80 | c       & 0x3F;
					}
					else {
						i++;
						c = 0x10000 ^ ( ( ( c & 0x3FF ) << 10 ) | ( value.charCodeAt( i ) & 0x3FF ) );
						this.buffer[ this.offset++ ] = 0xF0 | c >> 18       ;
						this.buffer[ this.offset++ ] = 0x80 | c >> 12 & 0x3F;
						this.buffer[ this.offset++ ] = 0x80 | c >> 6  & 0x3F;
						this.buffer[ this.offset++ ] = 0x80 | c       & 0x3F;
					}
				}
			}
			else if( length < 256 ) { // str8
				this.buffer[ this.offset++ ] = 217;
				this.buffer[ this.offset++ ] = length;
				this.buffer.write( value, this.offset, length, "utf8" );
				this.offset += length;
			}
			else if( length < 65536 ) { // str16
				this.buffer[ this.offset++ ] = 218;
				this.buffer[ this.offset++ ] = length >> 8;
				this.buffer[ this.offset++ ] = length;
				this.buffer.write( value, this.offset, length, "utf8" );
				this.offset += length;
			}
			else if( length < 4294967296 ) { // str32
				this.buffer[ this.offset++ ] = 219;
				this.buffer[ this.offset++ ] = length >> 24;
				this.buffer[ this.offset++ ] = length >> 16;
				this.buffer[ this.offset++ ] = length >> 8;
				this.buffer[ this.offset++ ] = length;
				this.buffer.write( value, this.offset, length, "utf8" );
				this.offset += length;
			}
			else {
				throw Error( "Max supported string length (4294967296) exceeded, encoding failure." );
			}
			break;
		case "number":
			if( !Number.isFinite( value ) ) {
				if( Number.isNaN( value ) ) { // NaN, fixext 1, type = 0, data = 1
					this.buffer[ this.offset++ ] = 212;
					this.buffer[ this.offset++ ] = 0;
					this.buffer[ this.offset++ ] = 1;
					break;
				}
				if( value === Infinity ) { // +Infinity, fixext 1, type = 0, data = 2
					this.buffer[ this.offset++ ] = 212;
					this.buffer[ this.offset++ ] = 0;
					this.buffer[ this.offset++ ] = 2;
					break;
				}
				if( value === -Infinity ) { // -Infinity, fixext 1, type = 0, data = 3
					this.buffer[ this.offset++ ] = 212;
					this.buffer[ this.offset++ ] = 0;
					this.buffer[ this.offset++ ] = 3;
					break;
				}
			}
			if( Math.floor( value ) !== value ) {
				if( Math.fround( value ) === value ) {
					this.buffer[ this.offset++ ] = 202;
					this.buffer.writeFloatBE( value, this.offset );
					this.offset += 4;
					break;
				}
				else {
					this.buffer[ this.offset++ ] = 203;
					this.buffer.writeDoubleBE( value, this.offset );
					this.offset += 8;
					break;
				}
			}
			if( value >= 0 ) {
				if( value < 128 ) { // positive fixint
					this.buffer[ this.offset++ ] = value;
					break;
				}
				if( value < 256 ) { // uint 8
					this.buffer[ this.offset++ ] = 204;
					this.buffer[ this.offset++ ] = value;
					break;
				}
				if( value < 65536 ) {  // uint 16
					this.buffer[ this.offset++ ] = 205;
					this.buffer[ this.offset++ ] = value >> 8;
					this.buffer[ this.offset++ ] = value;
					break;
				}
				if( value < 4294967296 ) { // uint 32
					this.buffer[ this.offset++ ] = 206;
					this.buffer[ this.offset++ ] = value >> 24;
					this.buffer[ this.offset++ ] = value >> 16;
					this.buffer[ this.offset++ ] = value >> 8;
					this.buffer[ this.offset++ ] = value;
					break;
				}
				// uint 64
				const hi = ( value / 4294967296 ) >> 0; const lo = value >>> 0;
				this.buffer[ this.offset++ ] = 207;
				this.buffer[ this.offset++ ] = hi >> 24;
				this.buffer[ this.offset++ ] = hi >> 16;
				this.buffer[ this.offset++ ] = hi >> 8;
				this.buffer[ this.offset++ ] = hi;
				this.buffer[ this.offset++ ] = lo >> 24;
				this.buffer[ this.offset++ ] = lo >> 16;
				this.buffer[ this.offset++ ] = lo >> 8;
				this.buffer[ this.offset++ ] = lo;
			}
			else {
				if( value >= -32 ) { // negative fixint
					this.buffer[ this.offset++ ] = value;
					break;
				}
				if( value >= -128 ) { // int 8
					this.buffer[ this.offset++ ] = 208;
					this.buffer[ this.offset++ ] = value;
					break;
				}
				if( value >= -12800 ) { // int 16
					this.buffer[ this.offset++ ] = 209;
					this.buffer[ this.offset++ ] = value >> 8;
					this.buffer[ this.offset++ ] = value;
					break;
				}
				if( value >= -128000000 ) { // int 32
					this.buffer[ this.offset++ ] = 210;
					this.buffer[ this.offset++ ] = value >> 24;
					this.buffer[ this.offset++ ] = value >> 16;
					this.buffer[ this.offset++ ] = value >> 8;
					this.buffer[ this.offset++ ] = value;
					break;
				}
				// int 64
				const hi = Math.floor( value / 4294967296 ); const lo = value >>> 0;
				this.buffer[ this.offset++ ] = 211;
				this.buffer[ this.offset++ ] = hi >> 24;
				this.buffer[ this.offset++ ] = hi >> 16;
				this.buffer[ this.offset++ ] = hi >> 8;
				this.buffer[ this.offset++ ] = hi;
				this.buffer[ this.offset++ ] = lo >> 24;
				this.buffer[ this.offset++ ] = lo >> 16;
				this.buffer[ this.offset++ ] = lo >> 8;
				this.buffer[ this.offset++ ] = lo;
			}
			break;
		case "object":
			if( value === null ) { // null
				this.buffer[ this.offset++ ] = 192;
				break;
			}
			if( Array.isArray( value ) ) {
				length = value.length;
				if( length < 16 ) { // fixarray
					this.buffer[ this.offset++ ] = length | 144;
				}
				else if( length < 65536 ) { // array 16
					this.buffer[ this.offset++ ] = 220;
					this.buffer[ this.offset++ ] = length >> 8;
					this.buffer[ this.offset++ ] = length;
				}
				else if( length < 4294967296 ) { // array 32
					this.buffer[ this.offset++ ] = 221;
					this.buffer[ this.offset++ ] = length >> 24;
					this.buffer[ this.offset++ ] = length >> 16;
					this.buffer[ this.offset++ ] = length >> 8;
					this.buffer[ this.offset++ ] = length;
				}
				else {
					throw new Error( "Array too large" );
				}
				for( let i = 0; i < length; i++ ) {
					this.encode( value[ i ], true );
				}
				break;
			}
			if( value instanceof ArrayBuffer ) { // arraybuffer to buffer
				value = Buffer.from( value );
			}
			else if(
				!( value instanceof Buffer ) &&
          ArrayBuffer.isView( value ) &&
          !( value instanceof DataView )
			) {
				let temp = Buffer.from( value.buffer );
				if( value.byteLength !== value.buffer.byteLength ) {
					temp = temp.slice( value.byteOffset, value.byteOffset + value.byteLength );
				}
				value = temp;
			}
			if( value instanceof Buffer ) { // typedarrays and buffer
				length = value.length;
				if( length < 256 ) { // bin8
					this.buffer[ this.offset++ ] = 196;
					this.buffer[ this.offset++ ] = length;
					if( length > 32 ) {
						value.copy( this.buffer, this.offset, 0, length );
						this.offset += length;
					}
					else {
						for( let i = 0; i < length; i++ ) {
							this.buffer[ this.offset++ ] = value[ i ];
						}
					}
				}
				else if( length < 65536 ) { // bin16
					this.buffer[ this.offset++ ] = 197;
					this.buffer[ this.offset++ ] = length >> 8;
					this.buffer[ this.offset++ ] = length;
					value.copy( this.buffer, this.offset, 0, length );
					this.offset += length;
				}
				else if( length < 4294967296 ) { // bin32
					this.buffer[ this.offset++ ] = 198;
					this.buffer[ this.offset++ ] = length >> 24;
					this.buffer[ this.offset++ ] = length >> 16;
					this.buffer[ this.offset++ ] = length >> 8;
					this.buffer[ this.offset++ ] = length;
					value.copy( this.buffer, this.offset, 0, length );
					this.offset += length;
				}
				else {
					throw Error( "Max supported buffer length(4294967296) exceeded, encoding failure." );
				}
				break;
			}
			else { // plain javascript object
				const keys = Object.keys( value );
				length = keys.length;
				if( length < 16 ) { // fixmap
					this.buffer[ this.offset++ ] = length | 128;
				}
				else if( length < 65536 ) { // map16
					this.buffer[ this.offset++ ] = 222;
					this.buffer[ this.offset++ ] = length >> 8;
					this.buffer[ this.offset++ ] = length;
				}
				else if( length < 4294967296 ) { // map32
					this.buffer[ this.offset++ ] = 223;
					this.buffer[ this.offset++ ] = length >> 24;
					this.buffer[ this.offset++ ] = length >> 16;
					this.buffer[ this.offset++ ] = length >> 8;
					this.buffer[ this.offset++ ] = length;
				}
				else {
					throw new Error( "Object too large" );
				}
				if( this.dictionary.size > 0 ) {
					for( let i = 0; i < length; i++ ) {
						this.encode( this.dictionary.get( keys[ i ] ) || keys[ i ], true );
						this.encode( value[ keys[ i ] ], true );
					}
				}
				else {
					for( let i = 0; i < length; i++ ) {
						this.encode( keys[ i ], true );
						this.encode( value[ keys[ i ] ], true );
					}
				}
			}
			break;
		case "boolean":
			if( value ) {
				this.buffer[ this.offset++ ] = 195;
			}
			else {
				this.buffer[ this.offset++ ] = 194;
			}
			break;
		case "undefined":
			this.buffer[ this.offset++ ] = 212;
			this.buffer[ this.offset++ ] = 0;
			this.buffer[ this.offset++ ] = 0;
			break;
		default:
			throw Error( "Error encoding value." );
		}
		if( persist !== true ) {
			return this.buffer.slice( 0, this.offset );
		}
	}

	decode( buffer, persist ) {
		let value; let length;
		if( persist !== true ) {
			this.offset = 0;
		}
		const firstByte = buffer[ this.offset++ ];
		if( firstByte < 192 ) {
			if( firstByte < 128 ) { // positive fixint
				return firstByte;
			}
			else if( firstByte < 144 ) { // fixmap
				length = firstByte & 31;
				value = {};
				if( this.dictionary.size > 0 ) {
					for( let i = 0, key; i < length; i++ ) {
						key = this.decode( buffer, true );
						value[ this.dictionary.get( key ) || key ] = this.decode( buffer, true );
					}
				}
				else {
					for( let i = 0; i < length; i++ ) {
						value[ this.decode( buffer, true ) ] = this.decode( buffer, true );
					}
				}
				return value;
			}
			else if( firstByte < 160 ) { // fixarray
				length = firstByte & 15;
				value = new Array( length );
				for( let i = 0; i < length; i++ ) {
					value[ i ] = this.decode( buffer, true );
				}
				return value;
			}
			else { // fixstr
				length = firstByte & 31;
				this.offset += length;
				return buffer.toString( "utf8", this.offset - length, this.offset );
			}
		}
		else if( firstByte > 223 ) { // negative fixint
			return firstByte - 256;
		}
		else {
			const offset = this.offset;
			switch( firstByte ) {
			case 202: // float 32
				this.offset += 4;
				return buffer.readFloatBE( offset );
			case 203: // float 64
				this.offset += 8;
				return buffer.readDoubleBE( offset );
			case 204: // uint 8
				return buffer.readUInt8( this.offset++ );
			case 205: // uint 16
				this.offset += 2;
				return buffer.readUInt16BE( offset );
			case 206: // uint 32
				this.offset += 4;
				return buffer.readUInt32BE( offset );
			case 207: // uint 64
				value = buffer.readUInt32BE( this.offset ) * 4294967296;
				this.offset += 4;
				value += buffer.readUInt32BE( this.offset );
				this.offset += 4;
				return value;
			case 208: // int 8
				return buffer.readInt8( this.offset++ );
			case 209: // int 16
				this.offset += 2;
				return buffer.readInt16BE( offset );
			case 210: // int 32
				this.offset += 4;
				return buffer.readInt32BE( offset );
			case 211: // int 64
				value = buffer.readInt32BE( this.offset ) * 4294967296;
				this.offset += 4;
				value += buffer.readUInt32BE( this.offset );
				this.offset += 4;
				return value;
			case 217: // str 8
				length = buffer.readUInt8( this.offset );
				this.offset += 1 + length;
				return buffer.toString( "utf8", this.offset - length, this.offset );
			case 218: // str 16
				length = buffer.readUInt16BE( this.offset );
				this.offset += 2 + length;
				return buffer.toString( "utf8", this.offset - length, this.offset );
			case 219: // str 32
				length = buffer.readUInt32BE( this.offset );
				this.offset += 4 + length;
				return buffer.toString( "utf8", this.offset - length, this.offset );
			case 212: // fixext 1
				if( buffer.readInt8( this.offset++ ) === 0 ) { // fixext 1, type = 0, data = ?
					return [ undefined, NaN, Infinity, -Infinity ][ buffer.readInt8( this.offset++ ) ];
				}
				break;
			case 192: // nil
				return null;
			case 194: // false
				return false;
			case 195: // true
				return true;
			case 220: // array16
				length = buffer.readUInt16BE( this.offset );
				this.offset += 2;
				value = new Array( length );
				for( let i = 0; i < length; i++ ) {
					value[ i ] = this.decode( buffer, true );
				}
				return value;
			case 221: // array32
				length = buffer.readUInt32BE( this.offset );
				this.offset += 4;
				value = new Array( length );
				for( let i = 0; i < length; i++ ) {
					value[ i ] = this.decode( buffer, true );
				}
				return value;
			case 222: // map16
				length = buffer.readUInt16BE( this.offset );
				this.offset += 2;
				value = {};
				if( this.dictionary.size > 0 ) {
					for( let i = 0, key; i < length; i++ ) {
						key = this.decode( buffer, true );
						value[ this.dictionary.get( key ) || key ] = this.decode( buffer, true );
					}
				}
				else {
					for( let i = 0; i < length; i++ ) {
						value[ this.decode( buffer, true ) ] = this.decode( buffer, true );
					}
				}
				return value;
			case 223: // map32
				length = buffer.readUInt32BE( this.offset );
				this.offset += 4;
				value = {};
				if( this.dictionary.size > 0 ) {
					for( let i = 0, key; i < length; i++ ) {
						key = this.decode( buffer, true );
						value[ this.dictionary.get( key ) || key ] = this.decode( buffer, true );
					}
				}
				else {
					for( let i = 0; i < length; i++ ) {
						value[ this.decode( buffer, true ) ] = this.decode( buffer, true );
					}
				}
				return value;
			case 196: // bin8
				length = buffer.readUInt8( this.offset );
				this.offset += 1 + length;
				return buffer.slice( this.offset - length, this.offset );
			case 197: // bin16
				length = buffer.readUInt16BE( this.offset );
				this.offset += 2 + length;
				return buffer.slice( this.offset - length, this.offset );
			case 198: // bin32
				length = buffer.readUInt32BE( this.offset );
				this.offset += 4 + length;
				return buffer.slice( this.offset - length, this.offset );
			}
			throw Error( "Error decoding value." );
		}
	}
};
