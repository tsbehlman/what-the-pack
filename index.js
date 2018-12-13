class Allocator {
  constructor (length) {
    this.buffer = Buffer.allocUnsafe(length || Buffer.poolSize).fill(0);
    this.offset = -1;
  }
  copy () {
    const latest = Buffer.allocUnsafe(this.offset + 1).fill(0);
    this.buffer.copy(latest, 0, 0, this.offset + 1);
    return latest;
  }
}

class Iterator {
  constructor (buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }
}

let allocator = new Allocator();
const iterator = new Iterator();
const dictionary = new Map();
let dictionaryOffset = -33;
/**
 * Why -33:
 * - This allows us to use the negative (-32 to -1) and positive fixint range (0 to 127)
 * - So instead of encoding the whole key string, we only encode a single byte
 * - That's (32 + 128) = 160 of your first entries being encoded in a single damn byte
 */
class MessagePack {
  static register (...args) {
    args.forEach(item => {
      dictionaryOffset += 1;
      dictionary.set(item, dictionaryOffset);
      dictionary.set(dictionaryOffset, item);
    });
  }
  static get dictionary () {
    return dictionary;
  }
  static reallocate (length) {
    allocator = new Allocator(length);
  }
  static get allocator () {
    return allocator;
  }
  static get iterator () {
    return iterator;
  }
  static encode (value, persist) {
    if (persist !== true) allocator.offset = 0;
    let length = 0;
    switch (typeof value) {
      case 'string':
        if (value.length < 16) {
          for (let i = 0, c = 0, l = value.length; i < l; i++) {
            c = value.charCodeAt(i);
            if (c < 0x80) {
              length += 1;
            } else if (c < 0x500) {
              length += 2;
            } else if (c < 0xD800 || c >= 0xE000) {
              length += 3;
            } else {
              i++;
              length += 4;
            }
          }
        }
        else {
          length = Buffer.byteLength(value);
        }
        if (length < 32) { // < 32, fixstr
          allocator.buffer[allocator.offset++] = length | 160;
          for (let i = 0, c = 0, l = value.length; i < l; i++) {
            c = value.charCodeAt(i);
            if (c < 0x80) {
              allocator.buffer[allocator.offset++] = c;
            } else if (c < 0x500) {
              allocator.buffer[allocator.offset++] = 0xC0 | c >> 6        ;
              allocator.buffer[allocator.offset++] = 0x80 | c       & 0x3F;
            } else if (c < 0xD800 || c >= 0xE000) {
              allocator.buffer[allocator.offset++] = 0xE0 | c >> 12       ;
              allocator.buffer[allocator.offset++] = 0x80 | c >> 6  & 0x3F;
              allocator.buffer[allocator.offset++] = 0x80 | c       & 0x3F;
            } else {
              i++;
              c = 0x10000 ^ (((c & 0x3FF) << 10) | (value.charCodeAt(i) & 0x3FF));
              allocator.buffer[allocator.offset++] = 0xF0 | c >> 18       ;
              allocator.buffer[allocator.offset++] = 0x80 | c >> 12 & 0x3F;
              allocator.buffer[allocator.offset++] = 0x80 | c >> 6  & 0x3F;
              allocator.buffer[allocator.offset++] = 0x80 | c       & 0x3F;
            }
          }
        } else if (length < 256) { // str8
          allocator.buffer[allocator.offset++] = 217;
          allocator.buffer[allocator.offset++] = length;
          allocator.buffer.write(value, allocator.offset, length, 'utf8');
          allocator.offset += length;
        } else if (length < 65536) { // str16
          allocator.buffer[allocator.offset++] = 218;
          allocator.buffer[allocator.offset++] = length >> 8;
          allocator.buffer[allocator.offset++] = length;
          allocator.buffer.write(value, allocator.offset, length, 'utf8');
          allocator.offset += length;
        } else if (length < 4294967296) { // str32
          allocator.buffer[allocator.offset++] = 219;
          allocator.buffer[allocator.offset++] = length >> 24;
          allocator.buffer[allocator.offset++] = length >> 16;
          allocator.buffer[allocator.offset++] = length >> 8;
          allocator.buffer[allocator.offset++] = length;
          allocator.buffer.write(value, allocator.offset, length, 'utf8');
          allocator.offset += length;
        } else {
          throw Error('Max supported string length (4294967296) exceeded, encoding failure.');
        }
        break;
      case 'number':
        if (!Number.isFinite(value)) {
          if (Number.isNaN(value)) { // NaN, fixext 1, type = 0, data = 1
            allocator.buffer[allocator.offset++] = 212;
            allocator.buffer[allocator.offset++] = 0;
            allocator.buffer[allocator.offset++] = 1;
            break;
          }
          if (value === Infinity) { // +Infinity, fixext 1, type = 0, data = 2
            allocator.buffer[allocator.offset++] = 212;
            allocator.buffer[allocator.offset++] = 0;
            allocator.buffer[allocator.offset++] = 2;
            break;
          }
          if (value === -Infinity) { // -Infinity, fixext 1, type = 0, data = 3
            allocator.buffer[allocator.offset++] = 212;
            allocator.buffer[allocator.offset++] = 0;
            allocator.buffer[allocator.offset++] = 3;
            break;
          }
        }
        if (Math.floor(value) !== value) {
          if (Math.fround(value) === value) {
            allocator.buffer[allocator.offset++] = 202;
            allocator.buffer.writeFloatBE(value, allocator.offset);
            allocator.offset += 4;
            break;
          } else {
            allocator.buffer[allocator.offset++] = 203;
            allocator.buffer.writeDoubleBE(value, allocator.offset);
            allocator.offset += 8;
            break;
          }
        }
        if (value >= 0) {
          if (value < 128) { // positive fixint
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          if (value < 256) { // uint 8
            allocator.buffer[allocator.offset++] = 204;
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          if (value < 65536) {  // uint 16
            allocator.buffer[allocator.offset++] = 205;
            allocator.buffer[allocator.offset++] = value >> 8;
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          if (value < 4294967296) { // uint 32
            allocator.buffer[allocator.offset++] = 206;
            allocator.buffer[allocator.offset++] = value >> 24;
            allocator.buffer[allocator.offset++] = value >> 16;
            allocator.buffer[allocator.offset++] = value >> 8;
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          // uint 64
          let hi = (value / 4294967296) >> 0, lo = value >>> 0;
          allocator.buffer[allocator.offset++] = 207;
          allocator.buffer[allocator.offset++] = hi >> 24;
          allocator.buffer[allocator.offset++] = hi >> 16;
          allocator.buffer[allocator.offset++] = hi >> 8;
          allocator.buffer[allocator.offset++] = hi;
          allocator.buffer[allocator.offset++] = lo >> 24;
          allocator.buffer[allocator.offset++] = lo >> 16;
          allocator.buffer[allocator.offset++] = lo >> 8;
          allocator.buffer[allocator.offset++] = lo;
        } else {
          if (value >= -32) { // negative fixint
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          if (value >= -128) { // int 8
            allocator.buffer[allocator.offset++] = 208;
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          if (value >= -12800) { // int 16
            allocator.buffer[allocator.offset++] = 209;
            allocator.buffer[allocator.offset++] = value >> 8;
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          if (value >= -128000000) { // int 32
            allocator.buffer[allocator.offset++] = 210;
            allocator.buffer[allocator.offset++] = value >> 24;
            allocator.buffer[allocator.offset++] = value >> 16;
            allocator.buffer[allocator.offset++] = value >> 8;
            allocator.buffer[allocator.offset++] = value;
            break;
          }
          // int 64
          let hi = Math.floor(value / 4294967296), lo = value >>> 0;
          allocator.buffer[allocator.offset++] = 211;
          allocator.buffer[allocator.offset++] = hi >> 24;
          allocator.buffer[allocator.offset++] = hi >> 16;
          allocator.buffer[allocator.offset++] = hi >> 8;
          allocator.buffer[allocator.offset++] = hi;
          allocator.buffer[allocator.offset++] = lo >> 24;
          allocator.buffer[allocator.offset++] = lo >> 16;
          allocator.buffer[allocator.offset++] = lo >> 8;
          allocator.buffer[allocator.offset++] = lo;
        }
        break;
      case 'object':
        if (value === null) { // null
          allocator.buffer[allocator.offset++] = 192;
          break;
        }
        if (Array.isArray(value)) {
          length = value.length;
          if (length < 16) { // fixarray
            allocator.buffer[allocator.offset++] = length | 144;
          } else if (length < 65536) { // array 16
            allocator.buffer[allocator.offset++] = 220;
            allocator.buffer[allocator.offset++] = length >> 8;
            allocator.buffer[allocator.offset++] = length;
          } else if (length < 4294967296) { // array 32
            allocator.buffer[allocator.offset++] = 221;
            allocator.buffer[allocator.offset++] = length >> 24;
            allocator.buffer[allocator.offset++] = length >> 16;
            allocator.buffer[allocator.offset++] = length >> 8;
            allocator.buffer[allocator.offset++] = length;
          } else {
            throw new Error('Array too large');
          }
          for (let i = 0; i < length; i++) {
            MessagePack.encode(value[i], true);
          }
          break;
        }
        if (value instanceof ArrayBuffer) { // arraybuffer to buffer
          value = Buffer.from(value);
        }
        else if (
          !(value instanceof Buffer) &&
          ArrayBuffer.isView( value ) &&
          !(value instanceof DataView)
        ) {
          let temp = Buffer.from(value.buffer);
          if (value.byteLength !== value.buffer.byteLength) {
            temp = temp.slice(value.byteOffset, value.byteOffset + value.byteLength)
          }
          value = temp;
        }
        if (value instanceof Buffer) { // typedarrays and buffer
          length = value.length;
          if (length < 256) { // bin8
            allocator.buffer[allocator.offset++] = 196;
            allocator.buffer[allocator.offset++] = length;
            if (length > 32) {
              value.copy(allocator.buffer, allocator.offset, 0, length);
              allocator.offset += length;
            } else {
              for (let i = 0; i < length; i++) {
                allocator.buffer[allocator.offset++] = value[i];
              }
            }
          } else if (length < 65536) { // bin16
            allocator.buffer[allocator.offset++] = 197;
            allocator.buffer[allocator.offset++] = length >> 8;
            allocator.buffer[allocator.offset++] = length;
            value.copy(allocator.buffer, allocator.offset, 0, length);
            allocator.offset += length;
          } else if (length < 4294967296) { // bin32
            allocator.buffer[allocator.offset++] = 198;
            allocator.buffer[allocator.offset++] = length >> 24;
            allocator.buffer[allocator.offset++] = length >> 16;
            allocator.buffer[allocator.offset++] = length >> 8;
            allocator.buffer[allocator.offset++] = length;
            value.copy(allocator.buffer, allocator.offset, 0, length);
            allocator.offset += length;
          } else {
            throw Error('Max supported buffer length (4294967296) exceeded, encoding failure.');
          }
          break;
        } else { // plain javascript object
          let keys = Object.keys(value);
          length = keys.length;
          if (length < 16) { // fixmap
            allocator.buffer[allocator.offset++] = length | 128;
          } else if (length < 65536) { // map16
            allocator.buffer[allocator.offset++] = 222;
            allocator.buffer[allocator.offset++] = length >> 8;
            allocator.buffer[allocator.offset++] = length;
          } else if (length < 4294967296) { // map32
            allocator.buffer[allocator.offset++] = 223;
            allocator.buffer[allocator.offset++] = length >> 24;
            allocator.buffer[allocator.offset++] = length >> 16;
            allocator.buffer[allocator.offset++] = length >> 8;
            allocator.buffer[allocator.offset++] = length;
          } else {
            throw new Error('Object too large');
          }
          if (dictionary.size > 0) {
            for (let i = 0; i < length; i++) {
              MessagePack.encode(dictionary.get(keys[i]) || keys[i], true);
              MessagePack.encode(value[keys[i]], true);
            }
          } else {
            for (let i = 0; i < length; i++) {
              MessagePack.encode(keys[i], true);
              MessagePack.encode(value[keys[i]], true);
            }
          }
        }
        break;
      case 'boolean':
        if (value) {
          allocator.buffer[allocator.offset++] = 195;
        }
        else {
          allocator.buffer[allocator.offset++] = 194;
        }
        break;
      case 'undefined':
        allocator.buffer[allocator.offset++] = 212;
        allocator.buffer[allocator.offset++] = 0;
        allocator.buffer[allocator.offset++] = 0;
        break;
      default:
        throw Error('Error encoding value.');
    }
    if (persist !== true) {
      return allocator.copy();
    }
  }

  static decode (buffer, persist) {
    let value, length;
    if (persist !== true) { // reset our iterator
      iterator.buffer = buffer;
      iterator.offset = 0;
    }
    const firstByte = iterator.buffer[iterator.offset++];
    if (firstByte < 192) {
      if (firstByte < 128) { // positive fixint
        return firstByte;
      } else if (firstByte < 144) { // fixmap
        length = firstByte & 31;
        value = {};
        if (dictionary.size > 0) {
          for (let i = 0, key; i < length; i++) {
            key = MessagePack.decode(undefined, true);
            value[dictionary.get(key) || key] = MessagePack.decode(undefined, true);
          }
        } else {
          for (let i = 0; i < length; i++) {
            value[MessagePack.decode(undefined, true)] = MessagePack.decode(undefined, true);
          }
        }
        return value;
      } else if (firstByte < 160) { // fixarray
        length = firstByte & 15;
        value = new Array(length);
        for (let i = 0; i < length; i++) {
          value[i] = MessagePack.decode(undefined, true);
        }
        return value;
      } else { // fixstr
        length = firstByte & 31;
        iterator.offset += length;
        return iterator.buffer.toString('utf8', iterator.offset - length, iterator.offset);
      }
    } else if (firstByte > 223) { // negative fixint
      return firstByte - 256;
    } else {
      const offset = iterator.offset;
      switch (firstByte) {
        case 202: // float 32
          iterator.offset += 4;
          return iterator.buffer.readFloatBE(offset);
        case 203: // float 64
          iterator.offset += 8;
          return iterator.buffer.readDoubleBE(offset);
        case 204: // uint 8
          return iterator.buffer.readUInt8(iterator.offset++);
        case 205: // uint 16
          iterator.offset += 2;
          return iterator.buffer.readUInt16BE(offset);
        case 206: // uint 32
          iterator.offset += 4;
          return iterator.buffer.readUInt32BE(offset);
        case 207: // uint 64
          value = iterator.buffer.readUInt32BE(iterator.offset) * 4294967296;
          iterator.offset += 4;
          value += iterator.buffer.readUInt32BE(iterator.offset);
          iterator.offset += 4;
          return value;
        case 208: // int 8
          return iterator.buffer.readInt8(iterator.offset++);
        case 209: // int 16
          iterator.offset += 2;
          return iterator.buffer.readInt16BE(offset);
        case 210: // int 32
          iterator.offset += 4;
          return iterator.buffer.readInt32BE(offset);
        case 211: // int 64
          value = iterator.buffer.readInt32BE(iterator.offset) * 4294967296;
          iterator.offset += 4;
          value += iterator.buffer.readUInt32BE(iterator.offset);
          iterator.offset += 4;
          return value;
        case 217: // str 8
          length = iterator.buffer.readUInt8(iterator.offset);
          iterator.offset += 1 + length;
          return iterator.buffer.toString('utf8', iterator.offset - length, iterator.offset);
        case 218: // str 16
          length = iterator.buffer.readUInt16BE(iterator.offset);
          iterator.offset += 2 + length;
          return iterator.buffer.toString('utf8', iterator.offset - length, iterator.offset);
        case 219: // str 32
          length = iterator.buffer.readUInt32BE(iterator.offset);
          iterator.offset += 4 + length;
          return iterator.buffer.toString('utf8', iterator.offset - length, iterator.offset);
        case 212: // fixext 1
          if (iterator.buffer.readInt8(iterator.offset++) === 0) { // fixext 1, type = 0, data = ?
            return [undefined, NaN, Infinity, -Infinity][iterator.buffer.readInt8(iterator.offset++)];
          }
          break;
        case 192: // nil
          return null;
        case 194: // false
          return false;
        case 195: // true
          return true;
        case 220: // array16
          length = iterator.buffer.readUInt16BE(iterator.offset);
          iterator.offset += 2;
          value = new Array(length);
          for (let i = 0; i < length; i++) {
            value[i] = MessagePack.decode(undefined, true);
          }
          return value;
        case 221: // array32
          length = iterator.buffer.readUInt32BE(iterator.offset);
          iterator.offset += 4;
          value = new Array(length);
          for (let i = 0; i < length; i++) {
            value[i] = MessagePack.decode(undefined, true);
          }
          return value;
        case 222: // map16
          length = iterator.buffer.readUInt16BE(iterator.offset);
          iterator.offset += 2;
          value = {};
          if (dictionary.size > 0) {
            for (let i = 0, key; i < length; i++) {
              key = MessagePack.decode(undefined, true);
              value[dictionary.get(key) || key] = MessagePack.decode(undefined, true);
            }
          } else {
            for (let i = 0; i < length; i++) {
              value[MessagePack.decode(undefined, true)] = MessagePack.decode(undefined, true);
            }
          }
          return value;
        case 223: // map32
          length = iterator.buffer.readUInt32BE(iterator.offset);
          iterator.offset += 4;
          value = {};
          if (dictionary.size > 0) {
            for (let i = 0, key; i < length; i++) {
              key = MessagePack.decode(undefined, true);
              value[dictionary.get(key) || key] = MessagePack.decode(undefined, true);
            }
          } else {
            for (let i = 0; i < length; i++) {
              value[MessagePack.decode(undefined, true)] = MessagePack.decode(undefined, true);
            }
          }
          return value;
        case 196: // bin8
          length = iterator.buffer.readUInt8(iterator.offset);
          iterator.offset += 1 + length;
          return iterator.buffer.slice(iterator.offset - length, iterator.offset);
        case 197: // bin16
          length = iterator.buffer.readUInt16BE(iterator.offset);
          iterator.offset += 2 + length;
          return iterator.buffer.slice(iterator.offset - length, iterator.offset);
        case 198: // bin32
          length = iterator.buffer.readUInt32BE(iterator.offset);
          iterator.offset += 4 + length;
          return iterator.buffer.slice(iterator.offset - length, iterator.offset);
      }
      throw Error('Error decoding value.');
    }
  }
}

MessagePack.log = console.log;

module.exports = MessagePack;
