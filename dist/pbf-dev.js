(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Pbf = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

module.exports = Pbf;

var ieee754 = require("ieee754");
var Long = require("long");

function Pbf(buf) {
  this.buf = ArrayBuffer.isView && ArrayBuffer.isView(buf) ? buf : new Uint8Array(buf || 0);
  this.pos = 0;
  this.type = 0;
  this.length = this.buf.length;
}

Pbf.Varint = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
Pbf.Fixed64 = 1; // 64-bit: double, fixed64, sfixed64
Pbf.Bytes = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
Pbf.Fixed32 = 5; // 32-bit: float, fixed32, sfixed32

var SHIFT_LEFT_32 = (1 << 16) * (1 << 16),
  SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;

Pbf.prototype = {
  destroy: function() {
    this.buf = null;
  },

  // === READING =================================================================

  readFields: function(readField, result, end) {
    end = end || this.length;

    while (this.pos < end) {
      var val = this.readVarint(),
        tag = val >> 3,
        startPos = this.pos;

      this.type = val & 0x7;
      readField(tag, result, this);

      if (this.pos === startPos) this.skip(val);
    }
    return result;
  },

  readMessage: function(readField, result) {
    return this.readFields(readField, result, this.readVarint() + this.pos);
  },

  readFixed32: function() {
    var val = readUInt32(this.buf, this.pos);
    this.pos += 4;
    return val;
  },

  readSFixed32: function() {
    var val = readInt32(this.buf, this.pos);
    this.pos += 4;
    return val;
  },

  // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)

  readFixed64: function() {
    var val = readUInt32(this.buf, this.pos) + readUInt32(this.buf, this.pos + 4) * SHIFT_LEFT_32;
    this.pos += 8;
    return val;
  },

  readSFixed64: function() {
    var val = readUInt32(this.buf, this.pos) + readInt32(this.buf, this.pos + 4) * SHIFT_LEFT_32;
    this.pos += 8;
    return val;
  },

  readFloat: function() {
    var val = ieee754.read(this.buf, this.pos, true, 23, 4);
    this.pos += 4;
    return val;
  },

  readDouble: function() {
    var val = ieee754.read(this.buf, this.pos, true, 52, 8);
    this.pos += 8;
    return val;
  },

  readVarint: function(isSigned) {
    var buf = this.buf,
      val,
      b;

    b = buf[this.pos++];
    val = b & 0x7f;
    if (b < 0x80) return val;
    b = buf[this.pos++];
    val |= (b & 0x7f) << 7;
    if (b < 0x80) return val;
    b = buf[this.pos++];
    val |= (b & 0x7f) << 14;
    if (b < 0x80) return val;
    b = buf[this.pos++];
    val |= (b & 0x7f) << 21;
    if (b < 0x80) return val;
    b = buf[this.pos];
    val |= (b & 0x0f) << 28;

    return readVarintRemainder(val, isSigned, this);
  },

  readVarint64: function() {
    // for compatibility with v2.0.1
    return this.readVarint(true);
  },

  readSVarint: function() {
    var num = this.readVarint();
    return num % 2 === 1 ? (num + 1) / -2 : num / 2; // zigzag encoding
  },

  readBoolean: function() {
    return Boolean(this.readVarint());
  },

  readString: function() {
    var end = this.readVarint() + this.pos,
      str = readUtf8(this.buf, this.pos, end);
    this.pos = end;
    return str;
  },

  readBytes: function() {
    var end = this.readVarint() + this.pos,
      buffer = this.buf.subarray(this.pos, end);
    this.pos = end;
    return buffer;
  },

  // verbose for performance reasons; doesn't affect gzipped size

  readPackedVarint: function(arr, isSigned) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readVarint(isSigned));
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readVarint(isSigned));
    return arr;
  },
  readPackedSVarint: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readSVarint());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readSVarint());
    return arr;
  },
  readPackedBoolean: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readBoolean());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readBoolean());
    return arr;
  },
  readPackedFloat: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readFloat());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readFloat());
    return arr;
  },
  readPackedDouble: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readDouble());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readDouble());
    return arr;
  },
  readPackedFixed32: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readFixed32());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readFixed32());
    return arr;
  },
  readPackedSFixed32: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readSFixed32());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readSFixed32());
    return arr;
  },
  readPackedFixed64: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readFixed64());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readFixed64());
    return arr;
  },
  readPackedSFixed64: function(arr) {
    if (this.type !== Pbf.Bytes) return arr.push(this.readSFixed64());
    var end = readPackedEnd(this);
    arr = arr || [];
    while (this.pos < end) arr.push(this.readSFixed64());
    return arr;
  },

  skip: function(val) {
    var type = val & 0x7;
    if (type === Pbf.Varint) while (this.buf[this.pos++] > 0x7f) {}
    else if (type === Pbf.Bytes) this.pos = this.readVarint() + this.pos;
    else if (type === Pbf.Fixed32) this.pos += 4;
    else if (type === Pbf.Fixed64) this.pos += 8;
    else throw new Error("Unimplemented type: " + type);
  },

  // === WRITING =================================================================

  writeTag: function(tag, type) {
    this.writeVarint((tag << 3) | type);
  },

  realloc: function(min) {
    var length = this.length || 16;

    while (length < this.pos + min) length *= 2;

    if (length !== this.length) {
      var buf = new Uint8Array(length);
      buf.set(this.buf);
      this.buf = buf;
      this.length = length;
    }
  },

  finish: function() {
    this.length = this.pos;
    this.pos = 0;
    return this.buf.subarray(0, this.length);
  },

  writeFixed32: function(val) {
    this.realloc(4);
    writeInt32(this.buf, val, this.pos);
    this.pos += 4;
  },

  writeSFixed32: function(val) {
    this.realloc(4);
    writeInt32(this.buf, val, this.pos);
    this.pos += 4;
  },

  writeFixed64: function(val) {
    this.realloc(8);
    writeInt32(this.buf, val & -1, this.pos);
    writeInt32(this.buf, Math.floor(val * SHIFT_RIGHT_32), this.pos + 4);
    this.pos += 8;
  },

  writeSFixed64: function(val) {
    this.realloc(8);
    writeInt32(this.buf, val & -1, this.pos);
    writeInt32(this.buf, Math.floor(val * SHIFT_RIGHT_32), this.pos + 4);
    this.pos += 8;
  },

  writeVarint: function(val) {
    val = +val || 0;

    if (val > 0xfffffff || val < 0) {
      writeBigVarint(val, this);
      return;
    }

    this.realloc(4);

    this.buf[this.pos++] = (val & 0x7f) | (val > 0x7f ? 0x80 : 0);
    if (val <= 0x7f) return;
    this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0);
    if (val <= 0x7f) return;
    this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0);
    if (val <= 0x7f) return;
    this.buf[this.pos++] = (val >>> 7) & 0x7f;
  },

  writeSVarint: function(val) {
    this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
  },

  writeBoolean: function(val) {
    this.writeVarint(Boolean(val));
  },

  writeString: function(str) {
    str = String(str);
    this.realloc(str.length * 4);

    this.pos++; // reserve 1 byte for short string length

    var startPos = this.pos;
    // write the string directly to the buffer and see how much was written
    this.pos = writeUtf8(this.buf, str, this.pos);
    var len = this.pos - startPos;

    if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

    // finally, write the message length in the reserved place and restore the position
    this.pos = startPos - 1;
    this.writeVarint(len);
    this.pos += len;
  },

  writeFloat: function(val) {
    this.realloc(4);
    ieee754.write(this.buf, val, this.pos, true, 23, 4);
    this.pos += 4;
  },

  writeDouble: function(val) {
    this.realloc(8);
    ieee754.write(this.buf, val, this.pos, true, 52, 8);
    this.pos += 8;
  },

  writeBytes: function(buffer) {
    var len = buffer.length;
    this.writeVarint(len);
    this.realloc(len);
    for (var i = 0; i < len; i++) this.buf[this.pos++] = buffer[i];
  },

  writeRawMessage: function(fn, obj) {
    this.pos++; // reserve 1 byte for short message length

    // write the message directly to the buffer and see how much was written
    var startPos = this.pos;
    fn(obj, this);
    var len = this.pos - startPos;

    if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

    // finally, write the message length in the reserved place and restore the position
    this.pos = startPos - 1;
    this.writeVarint(len);
    this.pos += len;
  },

  writeMessage: function(tag, fn, obj) {
    this.writeTag(tag, Pbf.Bytes);
    this.writeRawMessage(fn, obj);
  },

  writePackedVarint: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedVarint, arr);
  },
  writePackedSVarint: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedSVarint, arr);
  },
  writePackedBoolean: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedBoolean, arr);
  },
  writePackedFloat: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedFloat, arr);
  },
  writePackedDouble: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedDouble, arr);
  },
  writePackedFixed32: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedFixed32, arr);
  },
  writePackedSFixed32: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedSFixed32, arr);
  },
  writePackedFixed64: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedFixed64, arr);
  },
  writePackedSFixed64: function(tag, arr) {
    if (arr.length) this.writeMessage(tag, writePackedSFixed64, arr);
  },

  writeBytesField: function(tag, buffer) {
    this.writeTag(tag, Pbf.Bytes);
    this.writeBytes(buffer);
  },
  writeFixed32Field: function(tag, val) {
    this.writeTag(tag, Pbf.Fixed32);
    this.writeFixed32(val);
  },
  writeSFixed32Field: function(tag, val) {
    this.writeTag(tag, Pbf.Fixed32);
    this.writeSFixed32(val);
  },
  writeFixed64Field: function(tag, val) {
    this.writeTag(tag, Pbf.Fixed64);
    this.writeFixed64(val);
  },
  writeSFixed64Field: function(tag, val) {
    this.writeTag(tag, Pbf.Fixed64);
    this.writeSFixed64(val);
  },
  writeVarintField: function(tag, val) {
    this.writeTag(tag, Pbf.Varint);
    this.writeVarint(val);
  },
  writeSVarintField: function(tag, val) {
    this.writeTag(tag, Pbf.Varint);
    this.writeSVarint(val);
  },
  writeStringField: function(tag, str) {
    this.writeTag(tag, Pbf.Bytes);
    this.writeString(str);
  },
  writeFloatField: function(tag, val) {
    this.writeTag(tag, Pbf.Fixed32);
    this.writeFloat(val);
  },
  writeDoubleField: function(tag, val) {
    this.writeTag(tag, Pbf.Fixed64);
    this.writeDouble(val);
  },
  writeBooleanField: function(tag, val) {
    this.writeVarintField(tag, Boolean(val));
  },
};

function readVarintRemainder(l, s, p) {
  var buf = p.buf,
    h,
    b;

  b = buf[p.pos++];
  h = (b & 0x70) >> 4;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++];
  h |= (b & 0x7f) << 3;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++];
  h |= (b & 0x7f) << 10;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++];
  h |= (b & 0x7f) << 17;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++];
  h |= (b & 0x7f) << 24;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++];
  h |= (b & 0x01) << 31;
  if (b < 0x80) return toNum(l, h, s);

  throw new Error("Expected varint not more than 10 bytes");
}

function readPackedEnd(pbf) {
  return pbf.type === Pbf.Bytes ? pbf.readVarint() + pbf.pos : pbf.pos + 1;
}

function toNum(low, high, isSigned) {
  var num = new Long(low, high);
  if (num.gt(Number.MAX_SAFE_INTEGER) || num.lt(Number.MIN_SAFE_INTEGER)) {
    return num;
  } else {
    return num.toNumber();
  }
}

function writeBigVarint(val, pbf) {
  var low, high;

  if (val >= 0) {
    low = (val % 0x100000000) | 0;
    high = (val / 0x100000000) | 0;
  } else {
    low = ~(-val % 0x100000000);
    high = ~(-val / 0x100000000);

    if (low ^ 0xffffffff) {
      low = (low + 1) | 0;
    } else {
      low = 0;
      high = (high + 1) | 0;
    }
  }

  if (val >= 0x10000000000000000 || val < -0x10000000000000000) {
    throw new Error("Given varint doesn't fit into 10 bytes");
  }

  pbf.realloc(10);

  writeBigVarintLow(low, high, pbf);
  writeBigVarintHigh(high, pbf);
}

function writeBigVarintLow(low, high, pbf) {
  pbf.buf[pbf.pos++] = (low & 0x7f) | 0x80;
  low >>>= 7;
  pbf.buf[pbf.pos++] = (low & 0x7f) | 0x80;
  low >>>= 7;
  pbf.buf[pbf.pos++] = (low & 0x7f) | 0x80;
  low >>>= 7;
  pbf.buf[pbf.pos++] = (low & 0x7f) | 0x80;
  low >>>= 7;
  pbf.buf[pbf.pos] = low & 0x7f;
}

function writeBigVarintHigh(high, pbf) {
  var lsb = (high & 0x07) << 4;

  pbf.buf[pbf.pos++] |= lsb | ((high >>>= 3) ? 0x80 : 0);
  if (!high) return;
  pbf.buf[pbf.pos++] = (high & 0x7f) | ((high >>>= 7) ? 0x80 : 0);
  if (!high) return;
  pbf.buf[pbf.pos++] = (high & 0x7f) | ((high >>>= 7) ? 0x80 : 0);
  if (!high) return;
  pbf.buf[pbf.pos++] = (high & 0x7f) | ((high >>>= 7) ? 0x80 : 0);
  if (!high) return;
  pbf.buf[pbf.pos++] = (high & 0x7f) | ((high >>>= 7) ? 0x80 : 0);
  if (!high) return;
  pbf.buf[pbf.pos++] = high & 0x7f;
}

function makeRoomForExtraLength(startPos, len, pbf) {
  var extraLen =
    len <= 0x3fff
      ? 1
      : len <= 0x1fffff ? 2 : len <= 0xfffffff ? 3 : Math.ceil(Math.log(len) / (Math.LN2 * 7));

  // if 1 byte isn't enough for encoding message length, shift the data to the right
  pbf.realloc(extraLen);
  for (var i = pbf.pos - 1; i >= startPos; i--) pbf.buf[i + extraLen] = pbf.buf[i];
}

function writePackedVarint(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeVarint(arr[i]);
}
function writePackedSVarint(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeSVarint(arr[i]);
}
function writePackedFloat(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeFloat(arr[i]);
}
function writePackedDouble(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeDouble(arr[i]);
}
function writePackedBoolean(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeBoolean(arr[i]);
}
function writePackedFixed32(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeFixed32(arr[i]);
}
function writePackedSFixed32(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeSFixed32(arr[i]);
}
function writePackedFixed64(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeFixed64(arr[i]);
}
function writePackedSFixed64(arr, pbf) {
  for (var i = 0; i < arr.length; i++) pbf.writeSFixed64(arr[i]);
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

function readUInt32(buf, pos) {
  return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16)) + buf[pos + 3] * 0x1000000;
}

function writeInt32(buf, val, pos) {
  buf[pos] = val;
  buf[pos + 1] = val >>> 8;
  buf[pos + 2] = val >>> 16;
  buf[pos + 3] = val >>> 24;
}

function readInt32(buf, pos) {
  return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16)) + (buf[pos + 3] << 24);
}

function readUtf8(buf, pos, end) {
  var str = "";
  var i = pos;

  while (i < end) {
    var b0 = buf[i];
    var c = null; // codepoint
    var bytesPerSequence = b0 > 0xef ? 4 : b0 > 0xdf ? 3 : b0 > 0xbf ? 2 : 1;

    if (i + bytesPerSequence > end) break;

    var b1, b2, b3;

    if (bytesPerSequence === 1) {
      if (b0 < 0x80) {
        c = b0;
      }
    } else if (bytesPerSequence === 2) {
      b1 = buf[i + 1];
      if ((b1 & 0xc0) === 0x80) {
        c = ((b0 & 0x1f) << 0x6) | (b1 & 0x3f);
        if (c <= 0x7f) {
          c = null;
        }
      }
    } else if (bytesPerSequence === 3) {
      b1 = buf[i + 1];
      b2 = buf[i + 2];
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        c = ((b0 & 0xf) << 0xc) | ((b1 & 0x3f) << 0x6) | (b2 & 0x3f);
        if (c <= 0x7ff || (c >= 0xd800 && c <= 0xdfff)) {
          c = null;
        }
      }
    } else if (bytesPerSequence === 4) {
      b1 = buf[i + 1];
      b2 = buf[i + 2];
      b3 = buf[i + 3];
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
        c = ((b0 & 0xf) << 0x12) | ((b1 & 0x3f) << 0xc) | ((b2 & 0x3f) << 0x6) | (b3 & 0x3f);
        if (c <= 0xffff || c >= 0x110000) {
          c = null;
        }
      }
    }

    if (c === null) {
      c = 0xfffd;
      bytesPerSequence = 1;
    } else if (c > 0xffff) {
      c -= 0x10000;
      str += String.fromCharCode(((c >>> 10) & 0x3ff) | 0xd800);
      c = 0xdc00 | (c & 0x3ff);
    }

    str += String.fromCharCode(c);
    i += bytesPerSequence;
  }

  return str;
}

function writeUtf8(buf, str, pos) {
  for (var i = 0, c, lead; i < str.length; i++) {
    c = str.charCodeAt(i); // code point

    if (c > 0xd7ff && c < 0xe000) {
      if (lead) {
        if (c < 0xdc00) {
          buf[pos++] = 0xef;
          buf[pos++] = 0xbf;
          buf[pos++] = 0xbd;
          lead = c;
          continue;
        } else {
          c = ((lead - 0xd800) << 10) | (c - 0xdc00) | 0x10000;
          lead = null;
        }
      } else {
        if (c > 0xdbff || i + 1 === str.length) {
          buf[pos++] = 0xef;
          buf[pos++] = 0xbf;
          buf[pos++] = 0xbd;
        } else {
          lead = c;
        }
        continue;
      }
    } else if (lead) {
      buf[pos++] = 0xef;
      buf[pos++] = 0xbf;
      buf[pos++] = 0xbd;
      lead = null;
    }

    if (c < 0x80) {
      buf[pos++] = c;
    } else {
      if (c < 0x800) {
        buf[pos++] = (c >> 0x6) | 0xc0;
      } else {
        if (c < 0x10000) {
          buf[pos++] = (c >> 0xc) | 0xe0;
        } else {
          buf[pos++] = (c >> 0x12) | 0xf0;
          buf[pos++] = ((c >> 0xc) & 0x3f) | 0x80;
        }
        buf[pos++] = ((c >> 0x6) & 0x3f) | 0x80;
      }
      buf[pos++] = (c & 0x3f) | 0x80;
    }
  }
  return pos;
}

},{"ieee754":2,"long":3}],2:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],3:[function(require,module,exports){
module.exports = Long;

/**
 * wasm optimizations, to do native i64 multiplication and divide
 */
var wasm = null;

try {
  wasm = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 2, 96, 0, 1, 127, 96, 4, 127, 127, 127, 127, 1, 127, 3, 7, 6, 0, 1, 1, 1, 1, 1, 6, 6, 1, 127, 1, 65, 0, 11, 7, 50, 6, 3, 109, 117, 108, 0, 1, 5, 100, 105, 118, 95, 115, 0, 2, 5, 100, 105, 118, 95, 117, 0, 3, 5, 114, 101, 109, 95, 115, 0, 4, 5, 114, 101, 109, 95, 117, 0, 5, 8, 103, 101, 116, 95, 104, 105, 103, 104, 0, 0, 10, 191, 1, 6, 4, 0, 35, 0, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 126, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 127, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 128, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 129, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11, 36, 1, 1, 126, 32, 0, 173, 32, 1, 173, 66, 32, 134, 132, 32, 2, 173, 32, 3, 173, 66, 32, 134, 132, 130, 34, 4, 66, 32, 135, 167, 36, 0, 32, 4, 167, 11
  ])), {}).exports;
} catch (e) {
  // no wasm support :(
}

/**
 * Constructs a 64 bit two's-complement integer, given its low and high 32 bit values as *signed* integers.
 *  See the from* functions below for more convenient ways of constructing Longs.
 * @exports Long
 * @class A Long class for representing a 64 bit two's-complement integer value.
 * @param {number} low The low (signed) 32 bits of the long
 * @param {number} high The high (signed) 32 bits of the long
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @constructor
 */
function Long(low, high, unsigned) {

    /**
     * The low 32 bits as a signed value.
     * @type {number}
     */
    this.low = low | 0;

    /**
     * The high 32 bits as a signed value.
     * @type {number}
     */
    this.high = high | 0;

    /**
     * Whether unsigned or not.
     * @type {boolean}
     */
    this.unsigned = !!unsigned;
}

// The internal representation of a long is the two given signed, 32-bit values.
// We use 32-bit pieces because these are the size of integers on which
// Javascript performs bit-operations.  For operations like addition and
// multiplication, we split each number into 16 bit pieces, which can easily be
// multiplied within Javascript's floating-point representation without overflow
// or change in sign.
//
// In the algorithms below, we frequently reduce the negative case to the
// positive case by negating the input(s) and then post-processing the result.
// Note that we must ALWAYS check specially whether those values are MIN_VALUE
// (-2^63) because -MIN_VALUE == MIN_VALUE (since 2^63 cannot be represented as
// a positive number, it overflows back into a negative).  Not handling this
// case would often result in infinite recursion.
//
// Common constant values ZERO, ONE, NEG_ONE, etc. are defined below the from*
// methods on which they depend.

/**
 * An indicator used to reliably determine if an object is a Long or not.
 * @type {boolean}
 * @const
 * @private
 */
Long.prototype.__isLong__;

Object.defineProperty(Long.prototype, "__isLong__", { value: true });

/**
 * @function
 * @param {*} obj Object
 * @returns {boolean}
 * @inner
 */
function isLong(obj) {
    return (obj && obj["__isLong__"]) === true;
}

/**
 * Tests if the specified object is a Long.
 * @function
 * @param {*} obj Object
 * @returns {boolean}
 */
Long.isLong = isLong;

/**
 * A cache of the Long representations of small integer values.
 * @type {!Object}
 * @inner
 */
var INT_CACHE = {};

/**
 * A cache of the Long representations of small unsigned integer values.
 * @type {!Object}
 * @inner
 */
var UINT_CACHE = {};

/**
 * @param {number} value
 * @param {boolean=} unsigned
 * @returns {!Long}
 * @inner
 */
function fromInt(value, unsigned) {
    var obj, cachedObj, cache;
    if (unsigned) {
        value >>>= 0;
        if (cache = (0 <= value && value < 256)) {
            cachedObj = UINT_CACHE[value];
            if (cachedObj)
                return cachedObj;
        }
        obj = fromBits(value, (value | 0) < 0 ? -1 : 0, true);
        if (cache)
            UINT_CACHE[value] = obj;
        return obj;
    } else {
        value |= 0;
        if (cache = (-128 <= value && value < 128)) {
            cachedObj = INT_CACHE[value];
            if (cachedObj)
                return cachedObj;
        }
        obj = fromBits(value, value < 0 ? -1 : 0, false);
        if (cache)
            INT_CACHE[value] = obj;
        return obj;
    }
}

/**
 * Returns a Long representing the given 32 bit integer value.
 * @function
 * @param {number} value The 32 bit integer in question
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @returns {!Long} The corresponding Long value
 */
Long.fromInt = fromInt;

/**
 * @param {number} value
 * @param {boolean=} unsigned
 * @returns {!Long}
 * @inner
 */
function fromNumber(value, unsigned) {
    if (isNaN(value))
        return unsigned ? UZERO : ZERO;
    if (unsigned) {
        if (value < 0)
            return UZERO;
        if (value >= TWO_PWR_64_DBL)
            return MAX_UNSIGNED_VALUE;
    } else {
        if (value <= -TWO_PWR_63_DBL)
            return MIN_VALUE;
        if (value + 1 >= TWO_PWR_63_DBL)
            return MAX_VALUE;
    }
    if (value < 0)
        return fromNumber(-value, unsigned).neg();
    return fromBits((value % TWO_PWR_32_DBL) | 0, (value / TWO_PWR_32_DBL) | 0, unsigned);
}

/**
 * Returns a Long representing the given value, provided that it is a finite number. Otherwise, zero is returned.
 * @function
 * @param {number} value The number in question
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @returns {!Long} The corresponding Long value
 */
Long.fromNumber = fromNumber;

/**
 * @param {number} lowBits
 * @param {number} highBits
 * @param {boolean=} unsigned
 * @returns {!Long}
 * @inner
 */
function fromBits(lowBits, highBits, unsigned) {
    return new Long(lowBits, highBits, unsigned);
}

/**
 * Returns a Long representing the 64 bit integer that comes by concatenating the given low and high bits. Each is
 *  assumed to use 32 bits.
 * @function
 * @param {number} lowBits The low 32 bits
 * @param {number} highBits The high 32 bits
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @returns {!Long} The corresponding Long value
 */
Long.fromBits = fromBits;

/**
 * @function
 * @param {number} base
 * @param {number} exponent
 * @returns {number}
 * @inner
 */
var pow_dbl = Math.pow; // Used 4 times (4*8 to 15+4)

/**
 * @param {string} str
 * @param {(boolean|number)=} unsigned
 * @param {number=} radix
 * @returns {!Long}
 * @inner
 */
function fromString(str, unsigned, radix) {
    if (str.length === 0)
        throw Error('empty string');
    if (str === "NaN" || str === "Infinity" || str === "+Infinity" || str === "-Infinity")
        return ZERO;
    if (typeof unsigned === 'number') {
        // For goog.math.long compatibility
        radix = unsigned,
        unsigned = false;
    } else {
        unsigned = !! unsigned;
    }
    radix = radix || 10;
    if (radix < 2 || 36 < radix)
        throw RangeError('radix');

    var p;
    if ((p = str.indexOf('-')) > 0)
        throw Error('interior hyphen');
    else if (p === 0) {
        return fromString(str.substring(1), unsigned, radix).neg();
    }

    // Do several (8) digits each time through the loop, so as to
    // minimize the calls to the very expensive emulated div.
    var radixToPower = fromNumber(pow_dbl(radix, 8));

    var result = ZERO;
    for (var i = 0; i < str.length; i += 8) {
        var size = Math.min(8, str.length - i),
            value = parseInt(str.substring(i, i + size), radix);
        if (size < 8) {
            var power = fromNumber(pow_dbl(radix, size));
            result = result.mul(power).add(fromNumber(value));
        } else {
            result = result.mul(radixToPower);
            result = result.add(fromNumber(value));
        }
    }
    result.unsigned = unsigned;
    return result;
}

/**
 * Returns a Long representation of the given string, written using the specified radix.
 * @function
 * @param {string} str The textual representation of the Long
 * @param {(boolean|number)=} unsigned Whether unsigned or not, defaults to signed
 * @param {number=} radix The radix in which the text is written (2-36), defaults to 10
 * @returns {!Long} The corresponding Long value
 */
Long.fromString = fromString;

/**
 * @function
 * @param {!Long|number|string|!{low: number, high: number, unsigned: boolean}} val
 * @param {boolean=} unsigned
 * @returns {!Long}
 * @inner
 */
function fromValue(val, unsigned) {
    if (typeof val === 'number')
        return fromNumber(val, unsigned);
    if (typeof val === 'string')
        return fromString(val, unsigned);
    // Throws for non-objects, converts non-instanceof Long:
    return fromBits(val.low, val.high, typeof unsigned === 'boolean' ? unsigned : val.unsigned);
}

/**
 * Converts the specified value to a Long using the appropriate from* function for its type.
 * @function
 * @param {!Long|number|string|!{low: number, high: number, unsigned: boolean}} val Value
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @returns {!Long}
 */
Long.fromValue = fromValue;

// NOTE: the compiler should inline these constant values below and then remove these variables, so there should be
// no runtime penalty for these.

/**
 * @type {number}
 * @const
 * @inner
 */
var TWO_PWR_16_DBL = 1 << 16;

/**
 * @type {number}
 * @const
 * @inner
 */
var TWO_PWR_24_DBL = 1 << 24;

/**
 * @type {number}
 * @const
 * @inner
 */
var TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;

/**
 * @type {number}
 * @const
 * @inner
 */
var TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL;

/**
 * @type {number}
 * @const
 * @inner
 */
var TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2;

/**
 * @type {!Long}
 * @const
 * @inner
 */
var TWO_PWR_24 = fromInt(TWO_PWR_24_DBL);

/**
 * @type {!Long}
 * @inner
 */
var ZERO = fromInt(0);

/**
 * Signed zero.
 * @type {!Long}
 */
Long.ZERO = ZERO;

/**
 * @type {!Long}
 * @inner
 */
var UZERO = fromInt(0, true);

/**
 * Unsigned zero.
 * @type {!Long}
 */
Long.UZERO = UZERO;

/**
 * @type {!Long}
 * @inner
 */
var ONE = fromInt(1);

/**
 * Signed one.
 * @type {!Long}
 */
Long.ONE = ONE;

/**
 * @type {!Long}
 * @inner
 */
var UONE = fromInt(1, true);

/**
 * Unsigned one.
 * @type {!Long}
 */
Long.UONE = UONE;

/**
 * @type {!Long}
 * @inner
 */
var NEG_ONE = fromInt(-1);

/**
 * Signed negative one.
 * @type {!Long}
 */
Long.NEG_ONE = NEG_ONE;

/**
 * @type {!Long}
 * @inner
 */
var MAX_VALUE = fromBits(0xFFFFFFFF|0, 0x7FFFFFFF|0, false);

/**
 * Maximum signed value.
 * @type {!Long}
 */
Long.MAX_VALUE = MAX_VALUE;

/**
 * @type {!Long}
 * @inner
 */
var MAX_UNSIGNED_VALUE = fromBits(0xFFFFFFFF|0, 0xFFFFFFFF|0, true);

/**
 * Maximum unsigned value.
 * @type {!Long}
 */
Long.MAX_UNSIGNED_VALUE = MAX_UNSIGNED_VALUE;

/**
 * @type {!Long}
 * @inner
 */
var MIN_VALUE = fromBits(0, 0x80000000|0, false);

/**
 * Minimum signed value.
 * @type {!Long}
 */
Long.MIN_VALUE = MIN_VALUE;

/**
 * @alias Long.prototype
 * @inner
 */
var LongPrototype = Long.prototype;

/**
 * Converts the Long to a 32 bit integer, assuming it is a 32 bit integer.
 * @returns {number}
 */
LongPrototype.toInt = function toInt() {
    return this.unsigned ? this.low >>> 0 : this.low;
};

/**
 * Converts the Long to a the nearest floating-point representation of this value (double, 53 bit mantissa).
 * @returns {number}
 */
LongPrototype.toNumber = function toNumber() {
    if (this.unsigned)
        return ((this.high >>> 0) * TWO_PWR_32_DBL) + (this.low >>> 0);
    return this.high * TWO_PWR_32_DBL + (this.low >>> 0);
};

/**
 * Converts the Long to a string written in the specified radix.
 * @param {number=} radix Radix (2-36), defaults to 10
 * @returns {string}
 * @override
 * @throws {RangeError} If `radix` is out of range
 */
LongPrototype.toString = function toString(radix) {
    radix = radix || 10;
    if (radix < 2 || 36 < radix)
        throw RangeError('radix');
    if (this.isZero())
        return '0';
    if (this.isNegative()) { // Unsigned Longs are never negative
        if (this.eq(MIN_VALUE)) {
            // We need to change the Long value before it can be negated, so we remove
            // the bottom-most digit in this base and then recurse to do the rest.
            var radixLong = fromNumber(radix),
                div = this.div(radixLong),
                rem1 = div.mul(radixLong).sub(this);
            return div.toString(radix) + rem1.toInt().toString(radix);
        } else
            return '-' + this.neg().toString(radix);
    }

    // Do several (6) digits each time through the loop, so as to
    // minimize the calls to the very expensive emulated div.
    var radixToPower = fromNumber(pow_dbl(radix, 6), this.unsigned),
        rem = this;
    var result = '';
    while (true) {
        var remDiv = rem.div(radixToPower),
            intval = rem.sub(remDiv.mul(radixToPower)).toInt() >>> 0,
            digits = intval.toString(radix);
        rem = remDiv;
        if (rem.isZero())
            return digits + result;
        else {
            while (digits.length < 6)
                digits = '0' + digits;
            result = '' + digits + result;
        }
    }
};

/**
 * Gets the high 32 bits as a signed integer.
 * @returns {number} Signed high bits
 */
LongPrototype.getHighBits = function getHighBits() {
    return this.high;
};

/**
 * Gets the high 32 bits as an unsigned integer.
 * @returns {number} Unsigned high bits
 */
LongPrototype.getHighBitsUnsigned = function getHighBitsUnsigned() {
    return this.high >>> 0;
};

/**
 * Gets the low 32 bits as a signed integer.
 * @returns {number} Signed low bits
 */
LongPrototype.getLowBits = function getLowBits() {
    return this.low;
};

/**
 * Gets the low 32 bits as an unsigned integer.
 * @returns {number} Unsigned low bits
 */
LongPrototype.getLowBitsUnsigned = function getLowBitsUnsigned() {
    return this.low >>> 0;
};

/**
 * Gets the number of bits needed to represent the absolute value of this Long.
 * @returns {number}
 */
LongPrototype.getNumBitsAbs = function getNumBitsAbs() {
    if (this.isNegative()) // Unsigned Longs are never negative
        return this.eq(MIN_VALUE) ? 64 : this.neg().getNumBitsAbs();
    var val = this.high != 0 ? this.high : this.low;
    for (var bit = 31; bit > 0; bit--)
        if ((val & (1 << bit)) != 0)
            break;
    return this.high != 0 ? bit + 33 : bit + 1;
};

/**
 * Tests if this Long's value equals zero.
 * @returns {boolean}
 */
LongPrototype.isZero = function isZero() {
    return this.high === 0 && this.low === 0;
};

/**
 * Tests if this Long's value equals zero. This is an alias of {@link Long#isZero}.
 * @returns {boolean}
 */
LongPrototype.eqz = LongPrototype.isZero;

/**
 * Tests if this Long's value is negative.
 * @returns {boolean}
 */
LongPrototype.isNegative = function isNegative() {
    return !this.unsigned && this.high < 0;
};

/**
 * Tests if this Long's value is positive.
 * @returns {boolean}
 */
LongPrototype.isPositive = function isPositive() {
    return this.unsigned || this.high >= 0;
};

/**
 * Tests if this Long's value is odd.
 * @returns {boolean}
 */
LongPrototype.isOdd = function isOdd() {
    return (this.low & 1) === 1;
};

/**
 * Tests if this Long's value is even.
 * @returns {boolean}
 */
LongPrototype.isEven = function isEven() {
    return (this.low & 1) === 0;
};

/**
 * Tests if this Long's value equals the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.equals = function equals(other) {
    if (!isLong(other))
        other = fromValue(other);
    if (this.unsigned !== other.unsigned && (this.high >>> 31) === 1 && (other.high >>> 31) === 1)
        return false;
    return this.high === other.high && this.low === other.low;
};

/**
 * Tests if this Long's value equals the specified's. This is an alias of {@link Long#equals}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.eq = LongPrototype.equals;

/**
 * Tests if this Long's value differs from the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.notEquals = function notEquals(other) {
    return !this.eq(/* validates */ other);
};

/**
 * Tests if this Long's value differs from the specified's. This is an alias of {@link Long#notEquals}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.neq = LongPrototype.notEquals;

/**
 * Tests if this Long's value differs from the specified's. This is an alias of {@link Long#notEquals}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.ne = LongPrototype.notEquals;

/**
 * Tests if this Long's value is less than the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.lessThan = function lessThan(other) {
    return this.comp(/* validates */ other) < 0;
};

/**
 * Tests if this Long's value is less than the specified's. This is an alias of {@link Long#lessThan}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.lt = LongPrototype.lessThan;

/**
 * Tests if this Long's value is less than or equal the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.lessThanOrEqual = function lessThanOrEqual(other) {
    return this.comp(/* validates */ other) <= 0;
};

/**
 * Tests if this Long's value is less than or equal the specified's. This is an alias of {@link Long#lessThanOrEqual}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.lte = LongPrototype.lessThanOrEqual;

/**
 * Tests if this Long's value is less than or equal the specified's. This is an alias of {@link Long#lessThanOrEqual}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.le = LongPrototype.lessThanOrEqual;

/**
 * Tests if this Long's value is greater than the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.greaterThan = function greaterThan(other) {
    return this.comp(/* validates */ other) > 0;
};

/**
 * Tests if this Long's value is greater than the specified's. This is an alias of {@link Long#greaterThan}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.gt = LongPrototype.greaterThan;

/**
 * Tests if this Long's value is greater than or equal the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.greaterThanOrEqual = function greaterThanOrEqual(other) {
    return this.comp(/* validates */ other) >= 0;
};

/**
 * Tests if this Long's value is greater than or equal the specified's. This is an alias of {@link Long#greaterThanOrEqual}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.gte = LongPrototype.greaterThanOrEqual;

/**
 * Tests if this Long's value is greater than or equal the specified's. This is an alias of {@link Long#greaterThanOrEqual}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {boolean}
 */
LongPrototype.ge = LongPrototype.greaterThanOrEqual;

/**
 * Compares this Long's value with the specified's.
 * @param {!Long|number|string} other Other value
 * @returns {number} 0 if they are the same, 1 if the this is greater and -1
 *  if the given one is greater
 */
LongPrototype.compare = function compare(other) {
    if (!isLong(other))
        other = fromValue(other);
    if (this.eq(other))
        return 0;
    var thisNeg = this.isNegative(),
        otherNeg = other.isNegative();
    if (thisNeg && !otherNeg)
        return -1;
    if (!thisNeg && otherNeg)
        return 1;
    // At this point the sign bits are the same
    if (!this.unsigned)
        return this.sub(other).isNegative() ? -1 : 1;
    // Both are positive if at least one is unsigned
    return (other.high >>> 0) > (this.high >>> 0) || (other.high === this.high && (other.low >>> 0) > (this.low >>> 0)) ? -1 : 1;
};

/**
 * Compares this Long's value with the specified's. This is an alias of {@link Long#compare}.
 * @function
 * @param {!Long|number|string} other Other value
 * @returns {number} 0 if they are the same, 1 if the this is greater and -1
 *  if the given one is greater
 */
LongPrototype.comp = LongPrototype.compare;

/**
 * Negates this Long's value.
 * @returns {!Long} Negated Long
 */
LongPrototype.negate = function negate() {
    if (!this.unsigned && this.eq(MIN_VALUE))
        return MIN_VALUE;
    return this.not().add(ONE);
};

/**
 * Negates this Long's value. This is an alias of {@link Long#negate}.
 * @function
 * @returns {!Long} Negated Long
 */
LongPrototype.neg = LongPrototype.negate;

/**
 * Returns the sum of this and the specified Long.
 * @param {!Long|number|string} addend Addend
 * @returns {!Long} Sum
 */
LongPrototype.add = function add(addend) {
    if (!isLong(addend))
        addend = fromValue(addend);

    // Divide each number into 4 chunks of 16 bits, and then sum the chunks.

    var a48 = this.high >>> 16;
    var a32 = this.high & 0xFFFF;
    var a16 = this.low >>> 16;
    var a00 = this.low & 0xFFFF;

    var b48 = addend.high >>> 16;
    var b32 = addend.high & 0xFFFF;
    var b16 = addend.low >>> 16;
    var b00 = addend.low & 0xFFFF;

    var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 + b00;
    c16 += c00 >>> 16;
    c00 &= 0xFFFF;
    c16 += a16 + b16;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c32 += a32 + b32;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c48 += a48 + b48;
    c48 &= 0xFFFF;
    return fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
};

/**
 * Returns the difference of this and the specified Long.
 * @param {!Long|number|string} subtrahend Subtrahend
 * @returns {!Long} Difference
 */
LongPrototype.subtract = function subtract(subtrahend) {
    if (!isLong(subtrahend))
        subtrahend = fromValue(subtrahend);
    return this.add(subtrahend.neg());
};

/**
 * Returns the difference of this and the specified Long. This is an alias of {@link Long#subtract}.
 * @function
 * @param {!Long|number|string} subtrahend Subtrahend
 * @returns {!Long} Difference
 */
LongPrototype.sub = LongPrototype.subtract;

/**
 * Returns the product of this and the specified Long.
 * @param {!Long|number|string} multiplier Multiplier
 * @returns {!Long} Product
 */
LongPrototype.multiply = function multiply(multiplier) {
    if (this.isZero())
        return ZERO;
    if (!isLong(multiplier))
        multiplier = fromValue(multiplier);

    // use wasm support if present
    if (wasm) {
        var low = wasm.mul(this.low,
                           this.high,
                           multiplier.low,
                           multiplier.high);
        return fromBits(low, wasm.get_high(), this.unsigned);
    }

    if (multiplier.isZero())
        return ZERO;
    if (this.eq(MIN_VALUE))
        return multiplier.isOdd() ? MIN_VALUE : ZERO;
    if (multiplier.eq(MIN_VALUE))
        return this.isOdd() ? MIN_VALUE : ZERO;

    if (this.isNegative()) {
        if (multiplier.isNegative())
            return this.neg().mul(multiplier.neg());
        else
            return this.neg().mul(multiplier).neg();
    } else if (multiplier.isNegative())
        return this.mul(multiplier.neg()).neg();

    // If both longs are small, use float multiplication
    if (this.lt(TWO_PWR_24) && multiplier.lt(TWO_PWR_24))
        return fromNumber(this.toNumber() * multiplier.toNumber(), this.unsigned);

    // Divide each long into 4 chunks of 16 bits, and then add up 4x4 products.
    // We can skip products that would overflow.

    var a48 = this.high >>> 16;
    var a32 = this.high & 0xFFFF;
    var a16 = this.low >>> 16;
    var a00 = this.low & 0xFFFF;

    var b48 = multiplier.high >>> 16;
    var b32 = multiplier.high & 0xFFFF;
    var b16 = multiplier.low >>> 16;
    var b00 = multiplier.low & 0xFFFF;

    var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 * b00;
    c16 += c00 >>> 16;
    c00 &= 0xFFFF;
    c16 += a16 * b00;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c16 += a00 * b16;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c32 += a32 * b00;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c32 += a16 * b16;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c32 += a00 * b32;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
    c48 &= 0xFFFF;
    return fromBits((c16 << 16) | c00, (c48 << 16) | c32, this.unsigned);
};

/**
 * Returns the product of this and the specified Long. This is an alias of {@link Long#multiply}.
 * @function
 * @param {!Long|number|string} multiplier Multiplier
 * @returns {!Long} Product
 */
LongPrototype.mul = LongPrototype.multiply;

/**
 * Returns this Long divided by the specified. The result is signed if this Long is signed or
 *  unsigned if this Long is unsigned.
 * @param {!Long|number|string} divisor Divisor
 * @returns {!Long} Quotient
 */
LongPrototype.divide = function divide(divisor) {
    if (!isLong(divisor))
        divisor = fromValue(divisor);
    if (divisor.isZero())
        throw Error('division by zero');

    // use wasm support if present
    if (wasm) {
        // guard against signed division overflow: the largest
        // negative number / -1 would be 1 larger than the largest
        // positive number, due to two's complement.
        if (!this.unsigned &&
            this.high === -0x80000000 &&
            divisor.low === -1 && divisor.high === -1) {
            // be consistent with non-wasm code path
            return this;
        }
        var low = (this.unsigned ? wasm.div_u : wasm.div_s)(
            this.low,
            this.high,
            divisor.low,
            divisor.high
        );
        return fromBits(low, wasm.get_high(), this.unsigned);
    }

    if (this.isZero())
        return this.unsigned ? UZERO : ZERO;
    var approx, rem, res;
    if (!this.unsigned) {
        // This section is only relevant for signed longs and is derived from the
        // closure library as a whole.
        if (this.eq(MIN_VALUE)) {
            if (divisor.eq(ONE) || divisor.eq(NEG_ONE))
                return MIN_VALUE;  // recall that -MIN_VALUE == MIN_VALUE
            else if (divisor.eq(MIN_VALUE))
                return ONE;
            else {
                // At this point, we have |other| >= 2, so |this/other| < |MIN_VALUE|.
                var halfThis = this.shr(1);
                approx = halfThis.div(divisor).shl(1);
                if (approx.eq(ZERO)) {
                    return divisor.isNegative() ? ONE : NEG_ONE;
                } else {
                    rem = this.sub(divisor.mul(approx));
                    res = approx.add(rem.div(divisor));
                    return res;
                }
            }
        } else if (divisor.eq(MIN_VALUE))
            return this.unsigned ? UZERO : ZERO;
        if (this.isNegative()) {
            if (divisor.isNegative())
                return this.neg().div(divisor.neg());
            return this.neg().div(divisor).neg();
        } else if (divisor.isNegative())
            return this.div(divisor.neg()).neg();
        res = ZERO;
    } else {
        // The algorithm below has not been made for unsigned longs. It's therefore
        // required to take special care of the MSB prior to running it.
        if (!divisor.unsigned)
            divisor = divisor.toUnsigned();
        if (divisor.gt(this))
            return UZERO;
        if (divisor.gt(this.shru(1))) // 15 >>> 1 = 7 ; with divisor = 8 ; true
            return UONE;
        res = UZERO;
    }

    // Repeat the following until the remainder is less than other:  find a
    // floating-point that approximates remainder / other *from below*, add this
    // into the result, and subtract it from the remainder.  It is critical that
    // the approximate value is less than or equal to the real value so that the
    // remainder never becomes negative.
    rem = this;
    while (rem.gte(divisor)) {
        // Approximate the result of division. This may be a little greater or
        // smaller than the actual value.
        approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));

        // We will tweak the approximate result by changing it in the 48-th digit or
        // the smallest non-fractional digit, whichever is larger.
        var log2 = Math.ceil(Math.log(approx) / Math.LN2),
            delta = (log2 <= 48) ? 1 : pow_dbl(2, log2 - 48),

        // Decrease the approximation until it is smaller than the remainder.  Note
        // that if it is too large, the product overflows and is negative.
            approxRes = fromNumber(approx),
            approxRem = approxRes.mul(divisor);
        while (approxRem.isNegative() || approxRem.gt(rem)) {
            approx -= delta;
            approxRes = fromNumber(approx, this.unsigned);
            approxRem = approxRes.mul(divisor);
        }

        // We know the answer can't be zero... and actually, zero would cause
        // infinite recursion since we would make no progress.
        if (approxRes.isZero())
            approxRes = ONE;

        res = res.add(approxRes);
        rem = rem.sub(approxRem);
    }
    return res;
};

/**
 * Returns this Long divided by the specified. This is an alias of {@link Long#divide}.
 * @function
 * @param {!Long|number|string} divisor Divisor
 * @returns {!Long} Quotient
 */
LongPrototype.div = LongPrototype.divide;

/**
 * Returns this Long modulo the specified.
 * @param {!Long|number|string} divisor Divisor
 * @returns {!Long} Remainder
 */
LongPrototype.modulo = function modulo(divisor) {
    if (!isLong(divisor))
        divisor = fromValue(divisor);

    // use wasm support if present
    if (wasm) {
        var low = (this.unsigned ? wasm.rem_u : wasm.rem_s)(
            this.low,
            this.high,
            divisor.low,
            divisor.high
        );
        return fromBits(low, wasm.get_high(), this.unsigned);
    }

    return this.sub(this.div(divisor).mul(divisor));
};

/**
 * Returns this Long modulo the specified. This is an alias of {@link Long#modulo}.
 * @function
 * @param {!Long|number|string} divisor Divisor
 * @returns {!Long} Remainder
 */
LongPrototype.mod = LongPrototype.modulo;

/**
 * Returns this Long modulo the specified. This is an alias of {@link Long#modulo}.
 * @function
 * @param {!Long|number|string} divisor Divisor
 * @returns {!Long} Remainder
 */
LongPrototype.rem = LongPrototype.modulo;

/**
 * Returns the bitwise NOT of this Long.
 * @returns {!Long}
 */
LongPrototype.not = function not() {
    return fromBits(~this.low, ~this.high, this.unsigned);
};

/**
 * Returns the bitwise AND of this Long and the specified.
 * @param {!Long|number|string} other Other Long
 * @returns {!Long}
 */
LongPrototype.and = function and(other) {
    if (!isLong(other))
        other = fromValue(other);
    return fromBits(this.low & other.low, this.high & other.high, this.unsigned);
};

/**
 * Returns the bitwise OR of this Long and the specified.
 * @param {!Long|number|string} other Other Long
 * @returns {!Long}
 */
LongPrototype.or = function or(other) {
    if (!isLong(other))
        other = fromValue(other);
    return fromBits(this.low | other.low, this.high | other.high, this.unsigned);
};

/**
 * Returns the bitwise XOR of this Long and the given one.
 * @param {!Long|number|string} other Other Long
 * @returns {!Long}
 */
LongPrototype.xor = function xor(other) {
    if (!isLong(other))
        other = fromValue(other);
    return fromBits(this.low ^ other.low, this.high ^ other.high, this.unsigned);
};

/**
 * Returns this Long with bits shifted to the left by the given amount.
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shiftLeft = function shiftLeft(numBits) {
    if (isLong(numBits))
        numBits = numBits.toInt();
    if ((numBits &= 63) === 0)
        return this;
    else if (numBits < 32)
        return fromBits(this.low << numBits, (this.high << numBits) | (this.low >>> (32 - numBits)), this.unsigned);
    else
        return fromBits(0, this.low << (numBits - 32), this.unsigned);
};

/**
 * Returns this Long with bits shifted to the left by the given amount. This is an alias of {@link Long#shiftLeft}.
 * @function
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shl = LongPrototype.shiftLeft;

/**
 * Returns this Long with bits arithmetically shifted to the right by the given amount.
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shiftRight = function shiftRight(numBits) {
    if (isLong(numBits))
        numBits = numBits.toInt();
    if ((numBits &= 63) === 0)
        return this;
    else if (numBits < 32)
        return fromBits((this.low >>> numBits) | (this.high << (32 - numBits)), this.high >> numBits, this.unsigned);
    else
        return fromBits(this.high >> (numBits - 32), this.high >= 0 ? 0 : -1, this.unsigned);
};

/**
 * Returns this Long with bits arithmetically shifted to the right by the given amount. This is an alias of {@link Long#shiftRight}.
 * @function
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shr = LongPrototype.shiftRight;

/**
 * Returns this Long with bits logically shifted to the right by the given amount.
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shiftRightUnsigned = function shiftRightUnsigned(numBits) {
    if (isLong(numBits))
        numBits = numBits.toInt();
    numBits &= 63;
    if (numBits === 0)
        return this;
    else {
        var high = this.high;
        if (numBits < 32) {
            var low = this.low;
            return fromBits((low >>> numBits) | (high << (32 - numBits)), high >>> numBits, this.unsigned);
        } else if (numBits === 32)
            return fromBits(high, 0, this.unsigned);
        else
            return fromBits(high >>> (numBits - 32), 0, this.unsigned);
    }
};

/**
 * Returns this Long with bits logically shifted to the right by the given amount. This is an alias of {@link Long#shiftRightUnsigned}.
 * @function
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shru = LongPrototype.shiftRightUnsigned;

/**
 * Returns this Long with bits logically shifted to the right by the given amount. This is an alias of {@link Long#shiftRightUnsigned}.
 * @function
 * @param {number|!Long} numBits Number of bits
 * @returns {!Long} Shifted Long
 */
LongPrototype.shr_u = LongPrototype.shiftRightUnsigned;

/**
 * Converts this Long to signed.
 * @returns {!Long} Signed long
 */
LongPrototype.toSigned = function toSigned() {
    if (!this.unsigned)
        return this;
    return fromBits(this.low, this.high, false);
};

/**
 * Converts this Long to unsigned.
 * @returns {!Long} Unsigned long
 */
LongPrototype.toUnsigned = function toUnsigned() {
    if (this.unsigned)
        return this;
    return fromBits(this.low, this.high, true);
};

/**
 * Converts this Long to its byte representation.
 * @param {boolean=} le Whether little or big endian, defaults to big endian
 * @returns {!Array.<number>} Byte representation
 */
LongPrototype.toBytes = function toBytes(le) {
    return le ? this.toBytesLE() : this.toBytesBE();
};

/**
 * Converts this Long to its little endian byte representation.
 * @returns {!Array.<number>} Little endian byte representation
 */
LongPrototype.toBytesLE = function toBytesLE() {
    var hi = this.high,
        lo = this.low;
    return [
        lo        & 0xff,
        lo >>>  8 & 0xff,
        lo >>> 16 & 0xff,
        lo >>> 24       ,
        hi        & 0xff,
        hi >>>  8 & 0xff,
        hi >>> 16 & 0xff,
        hi >>> 24
    ];
};

/**
 * Converts this Long to its big endian byte representation.
 * @returns {!Array.<number>} Big endian byte representation
 */
LongPrototype.toBytesBE = function toBytesBE() {
    var hi = this.high,
        lo = this.low;
    return [
        hi >>> 24       ,
        hi >>> 16 & 0xff,
        hi >>>  8 & 0xff,
        hi        & 0xff,
        lo >>> 24       ,
        lo >>> 16 & 0xff,
        lo >>>  8 & 0xff,
        lo        & 0xff
    ];
};

/**
 * Creates a Long from its byte representation.
 * @param {!Array.<number>} bytes Byte representation
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @param {boolean=} le Whether little or big endian, defaults to big endian
 * @returns {Long} The corresponding Long value
 */
Long.fromBytes = function fromBytes(bytes, unsigned, le) {
    return le ? Long.fromBytesLE(bytes, unsigned) : Long.fromBytesBE(bytes, unsigned);
};

/**
 * Creates a Long from its little endian byte representation.
 * @param {!Array.<number>} bytes Little endian byte representation
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @returns {Long} The corresponding Long value
 */
Long.fromBytesLE = function fromBytesLE(bytes, unsigned) {
    return new Long(
        bytes[0]       |
        bytes[1] <<  8 |
        bytes[2] << 16 |
        bytes[3] << 24,
        bytes[4]       |
        bytes[5] <<  8 |
        bytes[6] << 16 |
        bytes[7] << 24,
        unsigned
    );
};

/**
 * Creates a Long from its big endian byte representation.
 * @param {!Array.<number>} bytes Big endian byte representation
 * @param {boolean=} unsigned Whether unsigned or not, defaults to signed
 * @returns {Long} The corresponding Long value
 */
Long.fromBytesBE = function fromBytesBE(bytes, unsigned) {
    return new Long(
        bytes[4] << 24 |
        bytes[5] << 16 |
        bytes[6] <<  8 |
        bytes[7],
        bytes[0] << 24 |
        bytes[1] << 16 |
        bytes[2] <<  8 |
        bytes[3],
        unsigned
    );
};

},{}]},{},[1])(1)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2xvbmcvc3JjL2xvbmcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDanJCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCJcInVzZSBzdHJpY3RcIjtcblxubW9kdWxlLmV4cG9ydHMgPSBQYmY7XG5cbnZhciBpZWVlNzU0ID0gcmVxdWlyZShcImllZWU3NTRcIik7XG52YXIgTG9uZyA9IHJlcXVpcmUoXCJsb25nXCIpO1xuXG5mdW5jdGlvbiBQYmYoYnVmKSB7XG4gIHRoaXMuYnVmID0gQXJyYXlCdWZmZXIuaXNWaWV3ICYmIEFycmF5QnVmZmVyLmlzVmlldyhidWYpID8gYnVmIDogbmV3IFVpbnQ4QXJyYXkoYnVmIHx8IDApO1xuICB0aGlzLnBvcyA9IDA7XG4gIHRoaXMudHlwZSA9IDA7XG4gIHRoaXMubGVuZ3RoID0gdGhpcy5idWYubGVuZ3RoO1xufVxuXG5QYmYuVmFyaW50ID0gMDsgLy8gdmFyaW50OiBpbnQzMiwgaW50NjQsIHVpbnQzMiwgdWludDY0LCBzaW50MzIsIHNpbnQ2NCwgYm9vbCwgZW51bVxuUGJmLkZpeGVkNjQgPSAxOyAvLyA2NC1iaXQ6IGRvdWJsZSwgZml4ZWQ2NCwgc2ZpeGVkNjRcblBiZi5CeXRlcyA9IDI7IC8vIGxlbmd0aC1kZWxpbWl0ZWQ6IHN0cmluZywgYnl0ZXMsIGVtYmVkZGVkIG1lc3NhZ2VzLCBwYWNrZWQgcmVwZWF0ZWQgZmllbGRzXG5QYmYuRml4ZWQzMiA9IDU7IC8vIDMyLWJpdDogZmxvYXQsIGZpeGVkMzIsIHNmaXhlZDMyXG5cbnZhciBTSElGVF9MRUZUXzMyID0gKDEgPDwgMTYpICogKDEgPDwgMTYpLFxuICBTSElGVF9SSUdIVF8zMiA9IDEgLyBTSElGVF9MRUZUXzMyO1xuXG5QYmYucHJvdG90eXBlID0ge1xuICBkZXN0cm95OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJ1ZiA9IG51bGw7XG4gIH0sXG5cbiAgLy8gPT09IFJFQURJTkcgPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICByZWFkRmllbGRzOiBmdW5jdGlvbihyZWFkRmllbGQsIHJlc3VsdCwgZW5kKSB7XG4gICAgZW5kID0gZW5kIHx8IHRoaXMubGVuZ3RoO1xuXG4gICAgd2hpbGUgKHRoaXMucG9zIDwgZW5kKSB7XG4gICAgICB2YXIgdmFsID0gdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgIHRhZyA9IHZhbCA+PiAzLFxuICAgICAgICBzdGFydFBvcyA9IHRoaXMucG9zO1xuXG4gICAgICB0aGlzLnR5cGUgPSB2YWwgJiAweDc7XG4gICAgICByZWFkRmllbGQodGFnLCByZXN1bHQsIHRoaXMpO1xuXG4gICAgICBpZiAodGhpcy5wb3MgPT09IHN0YXJ0UG9zKSB0aGlzLnNraXAodmFsKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuICByZWFkTWVzc2FnZTogZnVuY3Rpb24ocmVhZEZpZWxkLCByZXN1bHQpIHtcbiAgICByZXR1cm4gdGhpcy5yZWFkRmllbGRzKHJlYWRGaWVsZCwgcmVzdWx0LCB0aGlzLnJlYWRWYXJpbnQoKSArIHRoaXMucG9zKTtcbiAgfSxcblxuICByZWFkRml4ZWQzMjogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbCA9IHJlYWRVSW50MzIodGhpcy5idWYsIHRoaXMucG9zKTtcbiAgICB0aGlzLnBvcyArPSA0O1xuICAgIHJldHVybiB2YWw7XG4gIH0sXG5cbiAgcmVhZFNGaXhlZDMyOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsID0gcmVhZEludDMyKHRoaXMuYnVmLCB0aGlzLnBvcyk7XG4gICAgdGhpcy5wb3MgKz0gNDtcbiAgICByZXR1cm4gdmFsO1xuICB9LFxuXG4gIC8vIDY0LWJpdCBpbnQgaGFuZGxpbmcgaXMgYmFzZWQgb24gZ2l0aHViLmNvbS9kcHcvbm9kZS1idWZmZXItbW9yZS1pbnRzIChNSVQtbGljZW5zZWQpXG5cbiAgcmVhZEZpeGVkNjQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWwgPSByZWFkVUludDMyKHRoaXMuYnVmLCB0aGlzLnBvcykgKyByZWFkVUludDMyKHRoaXMuYnVmLCB0aGlzLnBvcyArIDQpICogU0hJRlRfTEVGVF8zMjtcbiAgICB0aGlzLnBvcyArPSA4O1xuICAgIHJldHVybiB2YWw7XG4gIH0sXG5cbiAgcmVhZFNGaXhlZDY0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsID0gcmVhZFVJbnQzMih0aGlzLmJ1ZiwgdGhpcy5wb3MpICsgcmVhZEludDMyKHRoaXMuYnVmLCB0aGlzLnBvcyArIDQpICogU0hJRlRfTEVGVF8zMjtcbiAgICB0aGlzLnBvcyArPSA4O1xuICAgIHJldHVybiB2YWw7XG4gIH0sXG5cbiAgcmVhZEZsb2F0OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsID0gaWVlZTc1NC5yZWFkKHRoaXMuYnVmLCB0aGlzLnBvcywgdHJ1ZSwgMjMsIDQpO1xuICAgIHRoaXMucG9zICs9IDQ7XG4gICAgcmV0dXJuIHZhbDtcbiAgfSxcblxuICByZWFkRG91YmxlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsID0gaWVlZTc1NC5yZWFkKHRoaXMuYnVmLCB0aGlzLnBvcywgdHJ1ZSwgNTIsIDgpO1xuICAgIHRoaXMucG9zICs9IDg7XG4gICAgcmV0dXJuIHZhbDtcbiAgfSxcblxuICByZWFkVmFyaW50OiBmdW5jdGlvbihpc1NpZ25lZCkge1xuICAgIHZhciBidWYgPSB0aGlzLmJ1ZixcbiAgICAgIHZhbCxcbiAgICAgIGI7XG5cbiAgICBiID0gYnVmW3RoaXMucG9zKytdO1xuICAgIHZhbCA9IGIgJiAweDdmO1xuICAgIGlmIChiIDwgMHg4MCkgcmV0dXJuIHZhbDtcbiAgICBiID0gYnVmW3RoaXMucG9zKytdO1xuICAgIHZhbCB8PSAoYiAmIDB4N2YpIDw8IDc7XG4gICAgaWYgKGIgPCAweDgwKSByZXR1cm4gdmFsO1xuICAgIGIgPSBidWZbdGhpcy5wb3MrK107XG4gICAgdmFsIHw9IChiICYgMHg3ZikgPDwgMTQ7XG4gICAgaWYgKGIgPCAweDgwKSByZXR1cm4gdmFsO1xuICAgIGIgPSBidWZbdGhpcy5wb3MrK107XG4gICAgdmFsIHw9IChiICYgMHg3ZikgPDwgMjE7XG4gICAgaWYgKGIgPCAweDgwKSByZXR1cm4gdmFsO1xuICAgIGIgPSBidWZbdGhpcy5wb3NdO1xuICAgIHZhbCB8PSAoYiAmIDB4MGYpIDw8IDI4O1xuXG4gICAgcmV0dXJuIHJlYWRWYXJpbnRSZW1haW5kZXIodmFsLCBpc1NpZ25lZCwgdGhpcyk7XG4gIH0sXG5cbiAgcmVhZFZhcmludDY0OiBmdW5jdGlvbigpIHtcbiAgICAvLyBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIHYyLjAuMVxuICAgIHJldHVybiB0aGlzLnJlYWRWYXJpbnQodHJ1ZSk7XG4gIH0sXG5cbiAgcmVhZFNWYXJpbnQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBudW0gPSB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICByZXR1cm4gbnVtICUgMiA9PT0gMSA/IChudW0gKyAxKSAvIC0yIDogbnVtIC8gMjsgLy8gemlnemFnIGVuY29kaW5nXG4gIH0sXG5cbiAgcmVhZEJvb2xlYW46IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMucmVhZFZhcmludCgpKTtcbiAgfSxcblxuICByZWFkU3RyaW5nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgZW5kID0gdGhpcy5yZWFkVmFyaW50KCkgKyB0aGlzLnBvcyxcbiAgICAgIHN0ciA9IHJlYWRVdGY4KHRoaXMuYnVmLCB0aGlzLnBvcywgZW5kKTtcbiAgICB0aGlzLnBvcyA9IGVuZDtcbiAgICByZXR1cm4gc3RyO1xuICB9LFxuXG4gIHJlYWRCeXRlczogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGVuZCA9IHRoaXMucmVhZFZhcmludCgpICsgdGhpcy5wb3MsXG4gICAgICBidWZmZXIgPSB0aGlzLmJ1Zi5zdWJhcnJheSh0aGlzLnBvcywgZW5kKTtcbiAgICB0aGlzLnBvcyA9IGVuZDtcbiAgICByZXR1cm4gYnVmZmVyO1xuICB9LFxuXG4gIC8vIHZlcmJvc2UgZm9yIHBlcmZvcm1hbmNlIHJlYXNvbnM7IGRvZXNuJ3QgYWZmZWN0IGd6aXBwZWQgc2l6ZVxuXG4gIHJlYWRQYWNrZWRWYXJpbnQ6IGZ1bmN0aW9uKGFyciwgaXNTaWduZWQpIHtcbiAgICBpZiAodGhpcy50eXBlICE9PSBQYmYuQnl0ZXMpIHJldHVybiBhcnIucHVzaCh0aGlzLnJlYWRWYXJpbnQoaXNTaWduZWQpKTtcbiAgICB2YXIgZW5kID0gcmVhZFBhY2tlZEVuZCh0aGlzKTtcbiAgICBhcnIgPSBhcnIgfHwgW107XG4gICAgd2hpbGUgKHRoaXMucG9zIDwgZW5kKSBhcnIucHVzaCh0aGlzLnJlYWRWYXJpbnQoaXNTaWduZWQpKTtcbiAgICByZXR1cm4gYXJyO1xuICB9LFxuICByZWFkUGFja2VkU1ZhcmludDogZnVuY3Rpb24oYXJyKSB7XG4gICAgaWYgKHRoaXMudHlwZSAhPT0gUGJmLkJ5dGVzKSByZXR1cm4gYXJyLnB1c2godGhpcy5yZWFkU1ZhcmludCgpKTtcbiAgICB2YXIgZW5kID0gcmVhZFBhY2tlZEVuZCh0aGlzKTtcbiAgICBhcnIgPSBhcnIgfHwgW107XG4gICAgd2hpbGUgKHRoaXMucG9zIDwgZW5kKSBhcnIucHVzaCh0aGlzLnJlYWRTVmFyaW50KCkpO1xuICAgIHJldHVybiBhcnI7XG4gIH0sXG4gIHJlYWRQYWNrZWRCb29sZWFuOiBmdW5jdGlvbihhcnIpIHtcbiAgICBpZiAodGhpcy50eXBlICE9PSBQYmYuQnl0ZXMpIHJldHVybiBhcnIucHVzaCh0aGlzLnJlYWRCb29sZWFuKCkpO1xuICAgIHZhciBlbmQgPSByZWFkUGFja2VkRW5kKHRoaXMpO1xuICAgIGFyciA9IGFyciB8fCBbXTtcbiAgICB3aGlsZSAodGhpcy5wb3MgPCBlbmQpIGFyci5wdXNoKHRoaXMucmVhZEJvb2xlYW4oKSk7XG4gICAgcmV0dXJuIGFycjtcbiAgfSxcbiAgcmVhZFBhY2tlZEZsb2F0OiBmdW5jdGlvbihhcnIpIHtcbiAgICBpZiAodGhpcy50eXBlICE9PSBQYmYuQnl0ZXMpIHJldHVybiBhcnIucHVzaCh0aGlzLnJlYWRGbG9hdCgpKTtcbiAgICB2YXIgZW5kID0gcmVhZFBhY2tlZEVuZCh0aGlzKTtcbiAgICBhcnIgPSBhcnIgfHwgW107XG4gICAgd2hpbGUgKHRoaXMucG9zIDwgZW5kKSBhcnIucHVzaCh0aGlzLnJlYWRGbG9hdCgpKTtcbiAgICByZXR1cm4gYXJyO1xuICB9LFxuICByZWFkUGFja2VkRG91YmxlOiBmdW5jdGlvbihhcnIpIHtcbiAgICBpZiAodGhpcy50eXBlICE9PSBQYmYuQnl0ZXMpIHJldHVybiBhcnIucHVzaCh0aGlzLnJlYWREb3VibGUoKSk7XG4gICAgdmFyIGVuZCA9IHJlYWRQYWNrZWRFbmQodGhpcyk7XG4gICAgYXJyID0gYXJyIHx8IFtdO1xuICAgIHdoaWxlICh0aGlzLnBvcyA8IGVuZCkgYXJyLnB1c2godGhpcy5yZWFkRG91YmxlKCkpO1xuICAgIHJldHVybiBhcnI7XG4gIH0sXG4gIHJlYWRQYWNrZWRGaXhlZDMyOiBmdW5jdGlvbihhcnIpIHtcbiAgICBpZiAodGhpcy50eXBlICE9PSBQYmYuQnl0ZXMpIHJldHVybiBhcnIucHVzaCh0aGlzLnJlYWRGaXhlZDMyKCkpO1xuICAgIHZhciBlbmQgPSByZWFkUGFja2VkRW5kKHRoaXMpO1xuICAgIGFyciA9IGFyciB8fCBbXTtcbiAgICB3aGlsZSAodGhpcy5wb3MgPCBlbmQpIGFyci5wdXNoKHRoaXMucmVhZEZpeGVkMzIoKSk7XG4gICAgcmV0dXJuIGFycjtcbiAgfSxcbiAgcmVhZFBhY2tlZFNGaXhlZDMyOiBmdW5jdGlvbihhcnIpIHtcbiAgICBpZiAodGhpcy50eXBlICE9PSBQYmYuQnl0ZXMpIHJldHVybiBhcnIucHVzaCh0aGlzLnJlYWRTRml4ZWQzMigpKTtcbiAgICB2YXIgZW5kID0gcmVhZFBhY2tlZEVuZCh0aGlzKTtcbiAgICBhcnIgPSBhcnIgfHwgW107XG4gICAgd2hpbGUgKHRoaXMucG9zIDwgZW5kKSBhcnIucHVzaCh0aGlzLnJlYWRTRml4ZWQzMigpKTtcbiAgICByZXR1cm4gYXJyO1xuICB9LFxuICByZWFkUGFja2VkRml4ZWQ2NDogZnVuY3Rpb24oYXJyKSB7XG4gICAgaWYgKHRoaXMudHlwZSAhPT0gUGJmLkJ5dGVzKSByZXR1cm4gYXJyLnB1c2godGhpcy5yZWFkRml4ZWQ2NCgpKTtcbiAgICB2YXIgZW5kID0gcmVhZFBhY2tlZEVuZCh0aGlzKTtcbiAgICBhcnIgPSBhcnIgfHwgW107XG4gICAgd2hpbGUgKHRoaXMucG9zIDwgZW5kKSBhcnIucHVzaCh0aGlzLnJlYWRGaXhlZDY0KCkpO1xuICAgIHJldHVybiBhcnI7XG4gIH0sXG4gIHJlYWRQYWNrZWRTRml4ZWQ2NDogZnVuY3Rpb24oYXJyKSB7XG4gICAgaWYgKHRoaXMudHlwZSAhPT0gUGJmLkJ5dGVzKSByZXR1cm4gYXJyLnB1c2godGhpcy5yZWFkU0ZpeGVkNjQoKSk7XG4gICAgdmFyIGVuZCA9IHJlYWRQYWNrZWRFbmQodGhpcyk7XG4gICAgYXJyID0gYXJyIHx8IFtdO1xuICAgIHdoaWxlICh0aGlzLnBvcyA8IGVuZCkgYXJyLnB1c2godGhpcy5yZWFkU0ZpeGVkNjQoKSk7XG4gICAgcmV0dXJuIGFycjtcbiAgfSxcblxuICBza2lwOiBmdW5jdGlvbih2YWwpIHtcbiAgICB2YXIgdHlwZSA9IHZhbCAmIDB4NztcbiAgICBpZiAodHlwZSA9PT0gUGJmLlZhcmludCkgd2hpbGUgKHRoaXMuYnVmW3RoaXMucG9zKytdID4gMHg3Zikge31cbiAgICBlbHNlIGlmICh0eXBlID09PSBQYmYuQnl0ZXMpIHRoaXMucG9zID0gdGhpcy5yZWFkVmFyaW50KCkgKyB0aGlzLnBvcztcbiAgICBlbHNlIGlmICh0eXBlID09PSBQYmYuRml4ZWQzMikgdGhpcy5wb3MgKz0gNDtcbiAgICBlbHNlIGlmICh0eXBlID09PSBQYmYuRml4ZWQ2NCkgdGhpcy5wb3MgKz0gODtcbiAgICBlbHNlIHRocm93IG5ldyBFcnJvcihcIlVuaW1wbGVtZW50ZWQgdHlwZTogXCIgKyB0eXBlKTtcbiAgfSxcblxuICAvLyA9PT0gV1JJVElORyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gIHdyaXRlVGFnOiBmdW5jdGlvbih0YWcsIHR5cGUpIHtcbiAgICB0aGlzLndyaXRlVmFyaW50KCh0YWcgPDwgMykgfCB0eXBlKTtcbiAgfSxcblxuICByZWFsbG9jOiBmdW5jdGlvbihtaW4pIHtcbiAgICB2YXIgbGVuZ3RoID0gdGhpcy5sZW5ndGggfHwgMTY7XG5cbiAgICB3aGlsZSAobGVuZ3RoIDwgdGhpcy5wb3MgKyBtaW4pIGxlbmd0aCAqPSAyO1xuXG4gICAgaWYgKGxlbmd0aCAhPT0gdGhpcy5sZW5ndGgpIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheShsZW5ndGgpO1xuICAgICAgYnVmLnNldCh0aGlzLmJ1Zik7XG4gICAgICB0aGlzLmJ1ZiA9IGJ1ZjtcbiAgICAgIHRoaXMubGVuZ3RoID0gbGVuZ3RoO1xuICAgIH1cbiAgfSxcblxuICBmaW5pc2g6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubGVuZ3RoID0gdGhpcy5wb3M7XG4gICAgdGhpcy5wb3MgPSAwO1xuICAgIHJldHVybiB0aGlzLmJ1Zi5zdWJhcnJheSgwLCB0aGlzLmxlbmd0aCk7XG4gIH0sXG5cbiAgd3JpdGVGaXhlZDMyOiBmdW5jdGlvbih2YWwpIHtcbiAgICB0aGlzLnJlYWxsb2MoNCk7XG4gICAgd3JpdGVJbnQzMih0aGlzLmJ1ZiwgdmFsLCB0aGlzLnBvcyk7XG4gICAgdGhpcy5wb3MgKz0gNDtcbiAgfSxcblxuICB3cml0ZVNGaXhlZDMyOiBmdW5jdGlvbih2YWwpIHtcbiAgICB0aGlzLnJlYWxsb2MoNCk7XG4gICAgd3JpdGVJbnQzMih0aGlzLmJ1ZiwgdmFsLCB0aGlzLnBvcyk7XG4gICAgdGhpcy5wb3MgKz0gNDtcbiAgfSxcblxuICB3cml0ZUZpeGVkNjQ6IGZ1bmN0aW9uKHZhbCkge1xuICAgIHRoaXMucmVhbGxvYyg4KTtcbiAgICB3cml0ZUludDMyKHRoaXMuYnVmLCB2YWwgJiAtMSwgdGhpcy5wb3MpO1xuICAgIHdyaXRlSW50MzIodGhpcy5idWYsIE1hdGguZmxvb3IodmFsICogU0hJRlRfUklHSFRfMzIpLCB0aGlzLnBvcyArIDQpO1xuICAgIHRoaXMucG9zICs9IDg7XG4gIH0sXG5cbiAgd3JpdGVTRml4ZWQ2NDogZnVuY3Rpb24odmFsKSB7XG4gICAgdGhpcy5yZWFsbG9jKDgpO1xuICAgIHdyaXRlSW50MzIodGhpcy5idWYsIHZhbCAmIC0xLCB0aGlzLnBvcyk7XG4gICAgd3JpdGVJbnQzMih0aGlzLmJ1ZiwgTWF0aC5mbG9vcih2YWwgKiBTSElGVF9SSUdIVF8zMiksIHRoaXMucG9zICsgNCk7XG4gICAgdGhpcy5wb3MgKz0gODtcbiAgfSxcblxuICB3cml0ZVZhcmludDogZnVuY3Rpb24odmFsKSB7XG4gICAgdmFsID0gK3ZhbCB8fCAwO1xuXG4gICAgaWYgKHZhbCA+IDB4ZmZmZmZmZiB8fCB2YWwgPCAwKSB7XG4gICAgICB3cml0ZUJpZ1ZhcmludCh2YWwsIHRoaXMpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMucmVhbGxvYyg0KTtcblxuICAgIHRoaXMuYnVmW3RoaXMucG9zKytdID0gKHZhbCAmIDB4N2YpIHwgKHZhbCA+IDB4N2YgPyAweDgwIDogMCk7XG4gICAgaWYgKHZhbCA8PSAweDdmKSByZXR1cm47XG4gICAgdGhpcy5idWZbdGhpcy5wb3MrK10gPSAoKHZhbCA+Pj49IDcpICYgMHg3ZikgfCAodmFsID4gMHg3ZiA/IDB4ODAgOiAwKTtcbiAgICBpZiAodmFsIDw9IDB4N2YpIHJldHVybjtcbiAgICB0aGlzLmJ1Zlt0aGlzLnBvcysrXSA9ICgodmFsID4+Pj0gNykgJiAweDdmKSB8ICh2YWwgPiAweDdmID8gMHg4MCA6IDApO1xuICAgIGlmICh2YWwgPD0gMHg3ZikgcmV0dXJuO1xuICAgIHRoaXMuYnVmW3RoaXMucG9zKytdID0gKHZhbCA+Pj4gNykgJiAweDdmO1xuICB9LFxuXG4gIHdyaXRlU1ZhcmludDogZnVuY3Rpb24odmFsKSB7XG4gICAgdGhpcy53cml0ZVZhcmludCh2YWwgPCAwID8gLXZhbCAqIDIgLSAxIDogdmFsICogMik7XG4gIH0sXG5cbiAgd3JpdGVCb29sZWFuOiBmdW5jdGlvbih2YWwpIHtcbiAgICB0aGlzLndyaXRlVmFyaW50KEJvb2xlYW4odmFsKSk7XG4gIH0sXG5cbiAgd3JpdGVTdHJpbmc6IGZ1bmN0aW9uKHN0cikge1xuICAgIHN0ciA9IFN0cmluZyhzdHIpO1xuICAgIHRoaXMucmVhbGxvYyhzdHIubGVuZ3RoICogNCk7XG5cbiAgICB0aGlzLnBvcysrOyAvLyByZXNlcnZlIDEgYnl0ZSBmb3Igc2hvcnQgc3RyaW5nIGxlbmd0aFxuXG4gICAgdmFyIHN0YXJ0UG9zID0gdGhpcy5wb3M7XG4gICAgLy8gd3JpdGUgdGhlIHN0cmluZyBkaXJlY3RseSB0byB0aGUgYnVmZmVyIGFuZCBzZWUgaG93IG11Y2ggd2FzIHdyaXR0ZW5cbiAgICB0aGlzLnBvcyA9IHdyaXRlVXRmOCh0aGlzLmJ1Ziwgc3RyLCB0aGlzLnBvcyk7XG4gICAgdmFyIGxlbiA9IHRoaXMucG9zIC0gc3RhcnRQb3M7XG5cbiAgICBpZiAobGVuID49IDB4ODApIG1ha2VSb29tRm9yRXh0cmFMZW5ndGgoc3RhcnRQb3MsIGxlbiwgdGhpcyk7XG5cbiAgICAvLyBmaW5hbGx5LCB3cml0ZSB0aGUgbWVzc2FnZSBsZW5ndGggaW4gdGhlIHJlc2VydmVkIHBsYWNlIGFuZCByZXN0b3JlIHRoZSBwb3NpdGlvblxuICAgIHRoaXMucG9zID0gc3RhcnRQb3MgLSAxO1xuICAgIHRoaXMud3JpdGVWYXJpbnQobGVuKTtcbiAgICB0aGlzLnBvcyArPSBsZW47XG4gIH0sXG5cbiAgd3JpdGVGbG9hdDogZnVuY3Rpb24odmFsKSB7XG4gICAgdGhpcy5yZWFsbG9jKDQpO1xuICAgIGllZWU3NTQud3JpdGUodGhpcy5idWYsIHZhbCwgdGhpcy5wb3MsIHRydWUsIDIzLCA0KTtcbiAgICB0aGlzLnBvcyArPSA0O1xuICB9LFxuXG4gIHdyaXRlRG91YmxlOiBmdW5jdGlvbih2YWwpIHtcbiAgICB0aGlzLnJlYWxsb2MoOCk7XG4gICAgaWVlZTc1NC53cml0ZSh0aGlzLmJ1ZiwgdmFsLCB0aGlzLnBvcywgdHJ1ZSwgNTIsIDgpO1xuICAgIHRoaXMucG9zICs9IDg7XG4gIH0sXG5cbiAgd3JpdGVCeXRlczogZnVuY3Rpb24oYnVmZmVyKSB7XG4gICAgdmFyIGxlbiA9IGJ1ZmZlci5sZW5ndGg7XG4gICAgdGhpcy53cml0ZVZhcmludChsZW4pO1xuICAgIHRoaXMucmVhbGxvYyhsZW4pO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHRoaXMuYnVmW3RoaXMucG9zKytdID0gYnVmZmVyW2ldO1xuICB9LFxuXG4gIHdyaXRlUmF3TWVzc2FnZTogZnVuY3Rpb24oZm4sIG9iaikge1xuICAgIHRoaXMucG9zKys7IC8vIHJlc2VydmUgMSBieXRlIGZvciBzaG9ydCBtZXNzYWdlIGxlbmd0aFxuXG4gICAgLy8gd3JpdGUgdGhlIG1lc3NhZ2UgZGlyZWN0bHkgdG8gdGhlIGJ1ZmZlciBhbmQgc2VlIGhvdyBtdWNoIHdhcyB3cml0dGVuXG4gICAgdmFyIHN0YXJ0UG9zID0gdGhpcy5wb3M7XG4gICAgZm4ob2JqLCB0aGlzKTtcbiAgICB2YXIgbGVuID0gdGhpcy5wb3MgLSBzdGFydFBvcztcblxuICAgIGlmIChsZW4gPj0gMHg4MCkgbWFrZVJvb21Gb3JFeHRyYUxlbmd0aChzdGFydFBvcywgbGVuLCB0aGlzKTtcblxuICAgIC8vIGZpbmFsbHksIHdyaXRlIHRoZSBtZXNzYWdlIGxlbmd0aCBpbiB0aGUgcmVzZXJ2ZWQgcGxhY2UgYW5kIHJlc3RvcmUgdGhlIHBvc2l0aW9uXG4gICAgdGhpcy5wb3MgPSBzdGFydFBvcyAtIDE7XG4gICAgdGhpcy53cml0ZVZhcmludChsZW4pO1xuICAgIHRoaXMucG9zICs9IGxlbjtcbiAgfSxcblxuICB3cml0ZU1lc3NhZ2U6IGZ1bmN0aW9uKHRhZywgZm4sIG9iaikge1xuICAgIHRoaXMud3JpdGVUYWcodGFnLCBQYmYuQnl0ZXMpO1xuICAgIHRoaXMud3JpdGVSYXdNZXNzYWdlKGZuLCBvYmopO1xuICB9LFxuXG4gIHdyaXRlUGFja2VkVmFyaW50OiBmdW5jdGlvbih0YWcsIGFycikge1xuICAgIGlmIChhcnIubGVuZ3RoKSB0aGlzLndyaXRlTWVzc2FnZSh0YWcsIHdyaXRlUGFja2VkVmFyaW50LCBhcnIpO1xuICB9LFxuICB3cml0ZVBhY2tlZFNWYXJpbnQ6IGZ1bmN0aW9uKHRhZywgYXJyKSB7XG4gICAgaWYgKGFyci5sZW5ndGgpIHRoaXMud3JpdGVNZXNzYWdlKHRhZywgd3JpdGVQYWNrZWRTVmFyaW50LCBhcnIpO1xuICB9LFxuICB3cml0ZVBhY2tlZEJvb2xlYW46IGZ1bmN0aW9uKHRhZywgYXJyKSB7XG4gICAgaWYgKGFyci5sZW5ndGgpIHRoaXMud3JpdGVNZXNzYWdlKHRhZywgd3JpdGVQYWNrZWRCb29sZWFuLCBhcnIpO1xuICB9LFxuICB3cml0ZVBhY2tlZEZsb2F0OiBmdW5jdGlvbih0YWcsIGFycikge1xuICAgIGlmIChhcnIubGVuZ3RoKSB0aGlzLndyaXRlTWVzc2FnZSh0YWcsIHdyaXRlUGFja2VkRmxvYXQsIGFycik7XG4gIH0sXG4gIHdyaXRlUGFja2VkRG91YmxlOiBmdW5jdGlvbih0YWcsIGFycikge1xuICAgIGlmIChhcnIubGVuZ3RoKSB0aGlzLndyaXRlTWVzc2FnZSh0YWcsIHdyaXRlUGFja2VkRG91YmxlLCBhcnIpO1xuICB9LFxuICB3cml0ZVBhY2tlZEZpeGVkMzI6IGZ1bmN0aW9uKHRhZywgYXJyKSB7XG4gICAgaWYgKGFyci5sZW5ndGgpIHRoaXMud3JpdGVNZXNzYWdlKHRhZywgd3JpdGVQYWNrZWRGaXhlZDMyLCBhcnIpO1xuICB9LFxuICB3cml0ZVBhY2tlZFNGaXhlZDMyOiBmdW5jdGlvbih0YWcsIGFycikge1xuICAgIGlmIChhcnIubGVuZ3RoKSB0aGlzLndyaXRlTWVzc2FnZSh0YWcsIHdyaXRlUGFja2VkU0ZpeGVkMzIsIGFycik7XG4gIH0sXG4gIHdyaXRlUGFja2VkRml4ZWQ2NDogZnVuY3Rpb24odGFnLCBhcnIpIHtcbiAgICBpZiAoYXJyLmxlbmd0aCkgdGhpcy53cml0ZU1lc3NhZ2UodGFnLCB3cml0ZVBhY2tlZEZpeGVkNjQsIGFycik7XG4gIH0sXG4gIHdyaXRlUGFja2VkU0ZpeGVkNjQ6IGZ1bmN0aW9uKHRhZywgYXJyKSB7XG4gICAgaWYgKGFyci5sZW5ndGgpIHRoaXMud3JpdGVNZXNzYWdlKHRhZywgd3JpdGVQYWNrZWRTRml4ZWQ2NCwgYXJyKTtcbiAgfSxcblxuICB3cml0ZUJ5dGVzRmllbGQ6IGZ1bmN0aW9uKHRhZywgYnVmZmVyKSB7XG4gICAgdGhpcy53cml0ZVRhZyh0YWcsIFBiZi5CeXRlcyk7XG4gICAgdGhpcy53cml0ZUJ5dGVzKGJ1ZmZlcik7XG4gIH0sXG4gIHdyaXRlRml4ZWQzMkZpZWxkOiBmdW5jdGlvbih0YWcsIHZhbCkge1xuICAgIHRoaXMud3JpdGVUYWcodGFnLCBQYmYuRml4ZWQzMik7XG4gICAgdGhpcy53cml0ZUZpeGVkMzIodmFsKTtcbiAgfSxcbiAgd3JpdGVTRml4ZWQzMkZpZWxkOiBmdW5jdGlvbih0YWcsIHZhbCkge1xuICAgIHRoaXMud3JpdGVUYWcodGFnLCBQYmYuRml4ZWQzMik7XG4gICAgdGhpcy53cml0ZVNGaXhlZDMyKHZhbCk7XG4gIH0sXG4gIHdyaXRlRml4ZWQ2NEZpZWxkOiBmdW5jdGlvbih0YWcsIHZhbCkge1xuICAgIHRoaXMud3JpdGVUYWcodGFnLCBQYmYuRml4ZWQ2NCk7XG4gICAgdGhpcy53cml0ZUZpeGVkNjQodmFsKTtcbiAgfSxcbiAgd3JpdGVTRml4ZWQ2NEZpZWxkOiBmdW5jdGlvbih0YWcsIHZhbCkge1xuICAgIHRoaXMud3JpdGVUYWcodGFnLCBQYmYuRml4ZWQ2NCk7XG4gICAgdGhpcy53cml0ZVNGaXhlZDY0KHZhbCk7XG4gIH0sXG4gIHdyaXRlVmFyaW50RmllbGQ6IGZ1bmN0aW9uKHRhZywgdmFsKSB7XG4gICAgdGhpcy53cml0ZVRhZyh0YWcsIFBiZi5WYXJpbnQpO1xuICAgIHRoaXMud3JpdGVWYXJpbnQodmFsKTtcbiAgfSxcbiAgd3JpdGVTVmFyaW50RmllbGQ6IGZ1bmN0aW9uKHRhZywgdmFsKSB7XG4gICAgdGhpcy53cml0ZVRhZyh0YWcsIFBiZi5WYXJpbnQpO1xuICAgIHRoaXMud3JpdGVTVmFyaW50KHZhbCk7XG4gIH0sXG4gIHdyaXRlU3RyaW5nRmllbGQ6IGZ1bmN0aW9uKHRhZywgc3RyKSB7XG4gICAgdGhpcy53cml0ZVRhZyh0YWcsIFBiZi5CeXRlcyk7XG4gICAgdGhpcy53cml0ZVN0cmluZyhzdHIpO1xuICB9LFxuICB3cml0ZUZsb2F0RmllbGQ6IGZ1bmN0aW9uKHRhZywgdmFsKSB7XG4gICAgdGhpcy53cml0ZVRhZyh0YWcsIFBiZi5GaXhlZDMyKTtcbiAgICB0aGlzLndyaXRlRmxvYXQodmFsKTtcbiAgfSxcbiAgd3JpdGVEb3VibGVGaWVsZDogZnVuY3Rpb24odGFnLCB2YWwpIHtcbiAgICB0aGlzLndyaXRlVGFnKHRhZywgUGJmLkZpeGVkNjQpO1xuICAgIHRoaXMud3JpdGVEb3VibGUodmFsKTtcbiAgfSxcbiAgd3JpdGVCb29sZWFuRmllbGQ6IGZ1bmN0aW9uKHRhZywgdmFsKSB7XG4gICAgdGhpcy53cml0ZVZhcmludEZpZWxkKHRhZywgQm9vbGVhbih2YWwpKTtcbiAgfSxcbn07XG5cbmZ1bmN0aW9uIHJlYWRWYXJpbnRSZW1haW5kZXIobCwgcywgcCkge1xuICB2YXIgYnVmID0gcC5idWYsXG4gICAgaCxcbiAgICBiO1xuXG4gIGIgPSBidWZbcC5wb3MrK107XG4gIGggPSAoYiAmIDB4NzApID4+IDQ7XG4gIGlmIChiIDwgMHg4MCkgcmV0dXJuIHRvTnVtKGwsIGgsIHMpO1xuICBiID0gYnVmW3AucG9zKytdO1xuICBoIHw9IChiICYgMHg3ZikgPDwgMztcbiAgaWYgKGIgPCAweDgwKSByZXR1cm4gdG9OdW0obCwgaCwgcyk7XG4gIGIgPSBidWZbcC5wb3MrK107XG4gIGggfD0gKGIgJiAweDdmKSA8PCAxMDtcbiAgaWYgKGIgPCAweDgwKSByZXR1cm4gdG9OdW0obCwgaCwgcyk7XG4gIGIgPSBidWZbcC5wb3MrK107XG4gIGggfD0gKGIgJiAweDdmKSA8PCAxNztcbiAgaWYgKGIgPCAweDgwKSByZXR1cm4gdG9OdW0obCwgaCwgcyk7XG4gIGIgPSBidWZbcC5wb3MrK107XG4gIGggfD0gKGIgJiAweDdmKSA8PCAyNDtcbiAgaWYgKGIgPCAweDgwKSByZXR1cm4gdG9OdW0obCwgaCwgcyk7XG4gIGIgPSBidWZbcC5wb3MrK107XG4gIGggfD0gKGIgJiAweDAxKSA8PCAzMTtcbiAgaWYgKGIgPCAweDgwKSByZXR1cm4gdG9OdW0obCwgaCwgcyk7XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgdmFyaW50IG5vdCBtb3JlIHRoYW4gMTAgYnl0ZXNcIik7XG59XG5cbmZ1bmN0aW9uIHJlYWRQYWNrZWRFbmQocGJmKSB7XG4gIHJldHVybiBwYmYudHlwZSA9PT0gUGJmLkJ5dGVzID8gcGJmLnJlYWRWYXJpbnQoKSArIHBiZi5wb3MgOiBwYmYucG9zICsgMTtcbn1cblxuZnVuY3Rpb24gdG9OdW0obG93LCBoaWdoLCBpc1NpZ25lZCkge1xuICB2YXIgbnVtID0gbmV3IExvbmcobG93LCBoaWdoKTtcbiAgaWYgKG51bS5ndChOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikgfHwgbnVtLmx0KE51bWJlci5NSU5fU0FGRV9JTlRFR0VSKSkge1xuICAgIHJldHVybiBudW07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG51bS50b051bWJlcigpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHdyaXRlQmlnVmFyaW50KHZhbCwgcGJmKSB7XG4gIHZhciBsb3csIGhpZ2g7XG5cbiAgaWYgKHZhbCA+PSAwKSB7XG4gICAgbG93ID0gKHZhbCAlIDB4MTAwMDAwMDAwKSB8IDA7XG4gICAgaGlnaCA9ICh2YWwgLyAweDEwMDAwMDAwMCkgfCAwO1xuICB9IGVsc2Uge1xuICAgIGxvdyA9IH4oLXZhbCAlIDB4MTAwMDAwMDAwKTtcbiAgICBoaWdoID0gfigtdmFsIC8gMHgxMDAwMDAwMDApO1xuXG4gICAgaWYgKGxvdyBeIDB4ZmZmZmZmZmYpIHtcbiAgICAgIGxvdyA9IChsb3cgKyAxKSB8IDA7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvdyA9IDA7XG4gICAgICBoaWdoID0gKGhpZ2ggKyAxKSB8IDA7XG4gICAgfVxuICB9XG5cbiAgaWYgKHZhbCA+PSAweDEwMDAwMDAwMDAwMDAwMDAwIHx8IHZhbCA8IC0weDEwMDAwMDAwMDAwMDAwMDAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiR2l2ZW4gdmFyaW50IGRvZXNuJ3QgZml0IGludG8gMTAgYnl0ZXNcIik7XG4gIH1cblxuICBwYmYucmVhbGxvYygxMCk7XG5cbiAgd3JpdGVCaWdWYXJpbnRMb3cobG93LCBoaWdoLCBwYmYpO1xuICB3cml0ZUJpZ1ZhcmludEhpZ2goaGlnaCwgcGJmKTtcbn1cblxuZnVuY3Rpb24gd3JpdGVCaWdWYXJpbnRMb3cobG93LCBoaWdoLCBwYmYpIHtcbiAgcGJmLmJ1ZltwYmYucG9zKytdID0gKGxvdyAmIDB4N2YpIHwgMHg4MDtcbiAgbG93ID4+Pj0gNztcbiAgcGJmLmJ1ZltwYmYucG9zKytdID0gKGxvdyAmIDB4N2YpIHwgMHg4MDtcbiAgbG93ID4+Pj0gNztcbiAgcGJmLmJ1ZltwYmYucG9zKytdID0gKGxvdyAmIDB4N2YpIHwgMHg4MDtcbiAgbG93ID4+Pj0gNztcbiAgcGJmLmJ1ZltwYmYucG9zKytdID0gKGxvdyAmIDB4N2YpIHwgMHg4MDtcbiAgbG93ID4+Pj0gNztcbiAgcGJmLmJ1ZltwYmYucG9zXSA9IGxvdyAmIDB4N2Y7XG59XG5cbmZ1bmN0aW9uIHdyaXRlQmlnVmFyaW50SGlnaChoaWdoLCBwYmYpIHtcbiAgdmFyIGxzYiA9IChoaWdoICYgMHgwNykgPDwgNDtcblxuICBwYmYuYnVmW3BiZi5wb3MrK10gfD0gbHNiIHwgKChoaWdoID4+Pj0gMykgPyAweDgwIDogMCk7XG4gIGlmICghaGlnaCkgcmV0dXJuO1xuICBwYmYuYnVmW3BiZi5wb3MrK10gPSAoaGlnaCAmIDB4N2YpIHwgKChoaWdoID4+Pj0gNykgPyAweDgwIDogMCk7XG4gIGlmICghaGlnaCkgcmV0dXJuO1xuICBwYmYuYnVmW3BiZi5wb3MrK10gPSAoaGlnaCAmIDB4N2YpIHwgKChoaWdoID4+Pj0gNykgPyAweDgwIDogMCk7XG4gIGlmICghaGlnaCkgcmV0dXJuO1xuICBwYmYuYnVmW3BiZi5wb3MrK10gPSAoaGlnaCAmIDB4N2YpIHwgKChoaWdoID4+Pj0gNykgPyAweDgwIDogMCk7XG4gIGlmICghaGlnaCkgcmV0dXJuO1xuICBwYmYuYnVmW3BiZi5wb3MrK10gPSAoaGlnaCAmIDB4N2YpIHwgKChoaWdoID4+Pj0gNykgPyAweDgwIDogMCk7XG4gIGlmICghaGlnaCkgcmV0dXJuO1xuICBwYmYuYnVmW3BiZi5wb3MrK10gPSBoaWdoICYgMHg3Zjtcbn1cblxuZnVuY3Rpb24gbWFrZVJvb21Gb3JFeHRyYUxlbmd0aChzdGFydFBvcywgbGVuLCBwYmYpIHtcbiAgdmFyIGV4dHJhTGVuID1cbiAgICBsZW4gPD0gMHgzZmZmXG4gICAgICA/IDFcbiAgICAgIDogbGVuIDw9IDB4MWZmZmZmID8gMiA6IGxlbiA8PSAweGZmZmZmZmYgPyAzIDogTWF0aC5jZWlsKE1hdGgubG9nKGxlbikgLyAoTWF0aC5MTjIgKiA3KSk7XG5cbiAgLy8gaWYgMSBieXRlIGlzbid0IGVub3VnaCBmb3IgZW5jb2RpbmcgbWVzc2FnZSBsZW5ndGgsIHNoaWZ0IHRoZSBkYXRhIHRvIHRoZSByaWdodFxuICBwYmYucmVhbGxvYyhleHRyYUxlbik7XG4gIGZvciAodmFyIGkgPSBwYmYucG9zIC0gMTsgaSA+PSBzdGFydFBvczsgaS0tKSBwYmYuYnVmW2kgKyBleHRyYUxlbl0gPSBwYmYuYnVmW2ldO1xufVxuXG5mdW5jdGlvbiB3cml0ZVBhY2tlZFZhcmludChhcnIsIHBiZikge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcGJmLndyaXRlVmFyaW50KGFycltpXSk7XG59XG5mdW5jdGlvbiB3cml0ZVBhY2tlZFNWYXJpbnQoYXJyLCBwYmYpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnIubGVuZ3RoOyBpKyspIHBiZi53cml0ZVNWYXJpbnQoYXJyW2ldKTtcbn1cbmZ1bmN0aW9uIHdyaXRlUGFja2VkRmxvYXQoYXJyLCBwYmYpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnIubGVuZ3RoOyBpKyspIHBiZi53cml0ZUZsb2F0KGFycltpXSk7XG59XG5mdW5jdGlvbiB3cml0ZVBhY2tlZERvdWJsZShhcnIsIHBiZikge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcGJmLndyaXRlRG91YmxlKGFycltpXSk7XG59XG5mdW5jdGlvbiB3cml0ZVBhY2tlZEJvb2xlYW4oYXJyLCBwYmYpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnIubGVuZ3RoOyBpKyspIHBiZi53cml0ZUJvb2xlYW4oYXJyW2ldKTtcbn1cbmZ1bmN0aW9uIHdyaXRlUGFja2VkRml4ZWQzMihhcnIsIHBiZikge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcGJmLndyaXRlRml4ZWQzMihhcnJbaV0pO1xufVxuZnVuY3Rpb24gd3JpdGVQYWNrZWRTRml4ZWQzMihhcnIsIHBiZikge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcGJmLndyaXRlU0ZpeGVkMzIoYXJyW2ldKTtcbn1cbmZ1bmN0aW9uIHdyaXRlUGFja2VkRml4ZWQ2NChhcnIsIHBiZikge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcGJmLndyaXRlRml4ZWQ2NChhcnJbaV0pO1xufVxuZnVuY3Rpb24gd3JpdGVQYWNrZWRTRml4ZWQ2NChhcnIsIHBiZikge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcGJmLndyaXRlU0ZpeGVkNjQoYXJyW2ldKTtcbn1cblxuLy8gQnVmZmVyIGNvZGUgYmVsb3cgZnJvbSBodHRwczovL2dpdGh1Yi5jb20vZmVyb3NzL2J1ZmZlciwgTUlULWxpY2Vuc2VkXG5cbmZ1bmN0aW9uIHJlYWRVSW50MzIoYnVmLCBwb3MpIHtcbiAgcmV0dXJuIChidWZbcG9zXSB8IChidWZbcG9zICsgMV0gPDwgOCkgfCAoYnVmW3BvcyArIDJdIDw8IDE2KSkgKyBidWZbcG9zICsgM10gKiAweDEwMDAwMDA7XG59XG5cbmZ1bmN0aW9uIHdyaXRlSW50MzIoYnVmLCB2YWwsIHBvcykge1xuICBidWZbcG9zXSA9IHZhbDtcbiAgYnVmW3BvcyArIDFdID0gdmFsID4+PiA4O1xuICBidWZbcG9zICsgMl0gPSB2YWwgPj4+IDE2O1xuICBidWZbcG9zICsgM10gPSB2YWwgPj4+IDI0O1xufVxuXG5mdW5jdGlvbiByZWFkSW50MzIoYnVmLCBwb3MpIHtcbiAgcmV0dXJuIChidWZbcG9zXSB8IChidWZbcG9zICsgMV0gPDwgOCkgfCAoYnVmW3BvcyArIDJdIDw8IDE2KSkgKyAoYnVmW3BvcyArIDNdIDw8IDI0KTtcbn1cblxuZnVuY3Rpb24gcmVhZFV0ZjgoYnVmLCBwb3MsIGVuZCkge1xuICB2YXIgc3RyID0gXCJcIjtcbiAgdmFyIGkgPSBwb3M7XG5cbiAgd2hpbGUgKGkgPCBlbmQpIHtcbiAgICB2YXIgYjAgPSBidWZbaV07XG4gICAgdmFyIGMgPSBudWxsOyAvLyBjb2RlcG9pbnRcbiAgICB2YXIgYnl0ZXNQZXJTZXF1ZW5jZSA9IGIwID4gMHhlZiA/IDQgOiBiMCA+IDB4ZGYgPyAzIDogYjAgPiAweGJmID8gMiA6IDE7XG5cbiAgICBpZiAoaSArIGJ5dGVzUGVyU2VxdWVuY2UgPiBlbmQpIGJyZWFrO1xuXG4gICAgdmFyIGIxLCBiMiwgYjM7XG5cbiAgICBpZiAoYnl0ZXNQZXJTZXF1ZW5jZSA9PT0gMSkge1xuICAgICAgaWYgKGIwIDwgMHg4MCkge1xuICAgICAgICBjID0gYjA7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChieXRlc1BlclNlcXVlbmNlID09PSAyKSB7XG4gICAgICBiMSA9IGJ1ZltpICsgMV07XG4gICAgICBpZiAoKGIxICYgMHhjMCkgPT09IDB4ODApIHtcbiAgICAgICAgYyA9ICgoYjAgJiAweDFmKSA8PCAweDYpIHwgKGIxICYgMHgzZik7XG4gICAgICAgIGlmIChjIDw9IDB4N2YpIHtcbiAgICAgICAgICBjID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYnl0ZXNQZXJTZXF1ZW5jZSA9PT0gMykge1xuICAgICAgYjEgPSBidWZbaSArIDFdO1xuICAgICAgYjIgPSBidWZbaSArIDJdO1xuICAgICAgaWYgKChiMSAmIDB4YzApID09PSAweDgwICYmIChiMiAmIDB4YzApID09PSAweDgwKSB7XG4gICAgICAgIGMgPSAoKGIwICYgMHhmKSA8PCAweGMpIHwgKChiMSAmIDB4M2YpIDw8IDB4NikgfCAoYjIgJiAweDNmKTtcbiAgICAgICAgaWYgKGMgPD0gMHg3ZmYgfHwgKGMgPj0gMHhkODAwICYmIGMgPD0gMHhkZmZmKSkge1xuICAgICAgICAgIGMgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChieXRlc1BlclNlcXVlbmNlID09PSA0KSB7XG4gICAgICBiMSA9IGJ1ZltpICsgMV07XG4gICAgICBiMiA9IGJ1ZltpICsgMl07XG4gICAgICBiMyA9IGJ1ZltpICsgM107XG4gICAgICBpZiAoKGIxICYgMHhjMCkgPT09IDB4ODAgJiYgKGIyICYgMHhjMCkgPT09IDB4ODAgJiYgKGIzICYgMHhjMCkgPT09IDB4ODApIHtcbiAgICAgICAgYyA9ICgoYjAgJiAweGYpIDw8IDB4MTIpIHwgKChiMSAmIDB4M2YpIDw8IDB4YykgfCAoKGIyICYgMHgzZikgPDwgMHg2KSB8IChiMyAmIDB4M2YpO1xuICAgICAgICBpZiAoYyA8PSAweGZmZmYgfHwgYyA+PSAweDExMDAwMCkge1xuICAgICAgICAgIGMgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGMgPT09IG51bGwpIHtcbiAgICAgIGMgPSAweGZmZmQ7XG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gMTtcbiAgICB9IGVsc2UgaWYgKGMgPiAweGZmZmYpIHtcbiAgICAgIGMgLT0gMHgxMDAwMDtcbiAgICAgIHN0ciArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKCgoYyA+Pj4gMTApICYgMHgzZmYpIHwgMHhkODAwKTtcbiAgICAgIGMgPSAweGRjMDAgfCAoYyAmIDB4M2ZmKTtcbiAgICB9XG5cbiAgICBzdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShjKTtcbiAgICBpICs9IGJ5dGVzUGVyU2VxdWVuY2U7XG4gIH1cblxuICByZXR1cm4gc3RyO1xufVxuXG5mdW5jdGlvbiB3cml0ZVV0ZjgoYnVmLCBzdHIsIHBvcykge1xuICBmb3IgKHZhciBpID0gMCwgYywgbGVhZDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKTsgLy8gY29kZSBwb2ludFxuXG4gICAgaWYgKGMgPiAweGQ3ZmYgJiYgYyA8IDB4ZTAwMCkge1xuICAgICAgaWYgKGxlYWQpIHtcbiAgICAgICAgaWYgKGMgPCAweGRjMDApIHtcbiAgICAgICAgICBidWZbcG9zKytdID0gMHhlZjtcbiAgICAgICAgICBidWZbcG9zKytdID0gMHhiZjtcbiAgICAgICAgICBidWZbcG9zKytdID0gMHhiZDtcbiAgICAgICAgICBsZWFkID0gYztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjID0gKChsZWFkIC0gMHhkODAwKSA8PCAxMCkgfCAoYyAtIDB4ZGMwMCkgfCAweDEwMDAwO1xuICAgICAgICAgIGxlYWQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoYyA+IDB4ZGJmZiB8fCBpICsgMSA9PT0gc3RyLmxlbmd0aCkge1xuICAgICAgICAgIGJ1Zltwb3MrK10gPSAweGVmO1xuICAgICAgICAgIGJ1Zltwb3MrK10gPSAweGJmO1xuICAgICAgICAgIGJ1Zltwb3MrK10gPSAweGJkO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxlYWQgPSBjO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGVhZCkge1xuICAgICAgYnVmW3BvcysrXSA9IDB4ZWY7XG4gICAgICBidWZbcG9zKytdID0gMHhiZjtcbiAgICAgIGJ1Zltwb3MrK10gPSAweGJkO1xuICAgICAgbGVhZCA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKGMgPCAweDgwKSB7XG4gICAgICBidWZbcG9zKytdID0gYztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGMgPCAweDgwMCkge1xuICAgICAgICBidWZbcG9zKytdID0gKGMgPj4gMHg2KSB8IDB4YzA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoYyA8IDB4MTAwMDApIHtcbiAgICAgICAgICBidWZbcG9zKytdID0gKGMgPj4gMHhjKSB8IDB4ZTA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYnVmW3BvcysrXSA9IChjID4+IDB4MTIpIHwgMHhmMDtcbiAgICAgICAgICBidWZbcG9zKytdID0gKChjID4+IDB4YykgJiAweDNmKSB8IDB4ODA7XG4gICAgICAgIH1cbiAgICAgICAgYnVmW3BvcysrXSA9ICgoYyA+PiAweDYpICYgMHgzZikgfCAweDgwO1xuICAgICAgfVxuICAgICAgYnVmW3BvcysrXSA9IChjICYgMHgzZikgfCAweDgwO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcG9zO1xufVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG1cbiAgdmFyIGVMZW4gPSAobkJ5dGVzICogOCkgLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSAoZSAqIDI1NikgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBlID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBtTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSAobSAqIDI1NikgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXNcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpXG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKVxuICAgIGUgPSBlIC0gZUJpYXNcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKVxufVxuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24gKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjXG4gIHZhciBlTGVuID0gKG5CeXRlcyAqIDgpIC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICgodmFsdWUgKiBjKSAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSBlICsgZUJpYXNcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gMFxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpIHt9XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbVxuICBlTGVuICs9IG1MZW5cbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KSB7fVxuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyOFxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBMb25nO1xyXG5cclxuLyoqXHJcbiAqIHdhc20gb3B0aW1pemF0aW9ucywgdG8gZG8gbmF0aXZlIGk2NCBtdWx0aXBsaWNhdGlvbiBhbmQgZGl2aWRlXHJcbiAqL1xyXG52YXIgd2FzbSA9IG51bGw7XHJcblxyXG50cnkge1xyXG4gIHdhc20gPSBuZXcgV2ViQXNzZW1ibHkuSW5zdGFuY2UobmV3IFdlYkFzc2VtYmx5Lk1vZHVsZShuZXcgVWludDhBcnJheShbXHJcbiAgICAwLCA5NywgMTE1LCAxMDksIDEsIDAsIDAsIDAsIDEsIDEzLCAyLCA5NiwgMCwgMSwgMTI3LCA5NiwgNCwgMTI3LCAxMjcsIDEyNywgMTI3LCAxLCAxMjcsIDMsIDcsIDYsIDAsIDEsIDEsIDEsIDEsIDEsIDYsIDYsIDEsIDEyNywgMSwgNjUsIDAsIDExLCA3LCA1MCwgNiwgMywgMTA5LCAxMTcsIDEwOCwgMCwgMSwgNSwgMTAwLCAxMDUsIDExOCwgOTUsIDExNSwgMCwgMiwgNSwgMTAwLCAxMDUsIDExOCwgOTUsIDExNywgMCwgMywgNSwgMTE0LCAxMDEsIDEwOSwgOTUsIDExNSwgMCwgNCwgNSwgMTE0LCAxMDEsIDEwOSwgOTUsIDExNywgMCwgNSwgOCwgMTAzLCAxMDEsIDExNiwgOTUsIDEwNCwgMTA1LCAxMDMsIDEwNCwgMCwgMCwgMTAsIDE5MSwgMSwgNiwgNCwgMCwgMzUsIDAsIDExLCAzNiwgMSwgMSwgMTI2LCAzMiwgMCwgMTczLCAzMiwgMSwgMTczLCA2NiwgMzIsIDEzNCwgMTMyLCAzMiwgMiwgMTczLCAzMiwgMywgMTczLCA2NiwgMzIsIDEzNCwgMTMyLCAxMjYsIDM0LCA0LCA2NiwgMzIsIDEzNSwgMTY3LCAzNiwgMCwgMzIsIDQsIDE2NywgMTEsIDM2LCAxLCAxLCAxMjYsIDMyLCAwLCAxNzMsIDMyLCAxLCAxNzMsIDY2LCAzMiwgMTM0LCAxMzIsIDMyLCAyLCAxNzMsIDMyLCAzLCAxNzMsIDY2LCAzMiwgMTM0LCAxMzIsIDEyNywgMzQsIDQsIDY2LCAzMiwgMTM1LCAxNjcsIDM2LCAwLCAzMiwgNCwgMTY3LCAxMSwgMzYsIDEsIDEsIDEyNiwgMzIsIDAsIDE3MywgMzIsIDEsIDE3MywgNjYsIDMyLCAxMzQsIDEzMiwgMzIsIDIsIDE3MywgMzIsIDMsIDE3MywgNjYsIDMyLCAxMzQsIDEzMiwgMTI4LCAzNCwgNCwgNjYsIDMyLCAxMzUsIDE2NywgMzYsIDAsIDMyLCA0LCAxNjcsIDExLCAzNiwgMSwgMSwgMTI2LCAzMiwgMCwgMTczLCAzMiwgMSwgMTczLCA2NiwgMzIsIDEzNCwgMTMyLCAzMiwgMiwgMTczLCAzMiwgMywgMTczLCA2NiwgMzIsIDEzNCwgMTMyLCAxMjksIDM0LCA0LCA2NiwgMzIsIDEzNSwgMTY3LCAzNiwgMCwgMzIsIDQsIDE2NywgMTEsIDM2LCAxLCAxLCAxMjYsIDMyLCAwLCAxNzMsIDMyLCAxLCAxNzMsIDY2LCAzMiwgMTM0LCAxMzIsIDMyLCAyLCAxNzMsIDMyLCAzLCAxNzMsIDY2LCAzMiwgMTM0LCAxMzIsIDEzMCwgMzQsIDQsIDY2LCAzMiwgMTM1LCAxNjcsIDM2LCAwLCAzMiwgNCwgMTY3LCAxMVxyXG4gIF0pKSwge30pLmV4cG9ydHM7XHJcbn0gY2F0Y2ggKGUpIHtcclxuICAvLyBubyB3YXNtIHN1cHBvcnQgOihcclxufVxyXG5cclxuLyoqXHJcbiAqIENvbnN0cnVjdHMgYSA2NCBiaXQgdHdvJ3MtY29tcGxlbWVudCBpbnRlZ2VyLCBnaXZlbiBpdHMgbG93IGFuZCBoaWdoIDMyIGJpdCB2YWx1ZXMgYXMgKnNpZ25lZCogaW50ZWdlcnMuXHJcbiAqICBTZWUgdGhlIGZyb20qIGZ1bmN0aW9ucyBiZWxvdyBmb3IgbW9yZSBjb252ZW5pZW50IHdheXMgb2YgY29uc3RydWN0aW5nIExvbmdzLlxyXG4gKiBAZXhwb3J0cyBMb25nXHJcbiAqIEBjbGFzcyBBIExvbmcgY2xhc3MgZm9yIHJlcHJlc2VudGluZyBhIDY0IGJpdCB0d28ncy1jb21wbGVtZW50IGludGVnZXIgdmFsdWUuXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBsb3cgVGhlIGxvdyAoc2lnbmVkKSAzMiBiaXRzIG9mIHRoZSBsb25nXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBoaWdoIFRoZSBoaWdoIChzaWduZWQpIDMyIGJpdHMgb2YgdGhlIGxvbmdcclxuICogQHBhcmFtIHtib29sZWFuPX0gdW5zaWduZWQgV2hldGhlciB1bnNpZ25lZCBvciBub3QsIGRlZmF1bHRzIHRvIHNpZ25lZFxyXG4gKiBAY29uc3RydWN0b3JcclxuICovXHJcbmZ1bmN0aW9uIExvbmcobG93LCBoaWdoLCB1bnNpZ25lZCkge1xyXG5cclxuICAgIC8qKlxyXG4gICAgICogVGhlIGxvdyAzMiBiaXRzIGFzIGEgc2lnbmVkIHZhbHVlLlxyXG4gICAgICogQHR5cGUge251bWJlcn1cclxuICAgICAqL1xyXG4gICAgdGhpcy5sb3cgPSBsb3cgfCAwO1xyXG5cclxuICAgIC8qKlxyXG4gICAgICogVGhlIGhpZ2ggMzIgYml0cyBhcyBhIHNpZ25lZCB2YWx1ZS5cclxuICAgICAqIEB0eXBlIHtudW1iZXJ9XHJcbiAgICAgKi9cclxuICAgIHRoaXMuaGlnaCA9IGhpZ2ggfCAwO1xyXG5cclxuICAgIC8qKlxyXG4gICAgICogV2hldGhlciB1bnNpZ25lZCBvciBub3QuXHJcbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn1cclxuICAgICAqL1xyXG4gICAgdGhpcy51bnNpZ25lZCA9ICEhdW5zaWduZWQ7XHJcbn1cclxuXHJcbi8vIFRoZSBpbnRlcm5hbCByZXByZXNlbnRhdGlvbiBvZiBhIGxvbmcgaXMgdGhlIHR3byBnaXZlbiBzaWduZWQsIDMyLWJpdCB2YWx1ZXMuXHJcbi8vIFdlIHVzZSAzMi1iaXQgcGllY2VzIGJlY2F1c2UgdGhlc2UgYXJlIHRoZSBzaXplIG9mIGludGVnZXJzIG9uIHdoaWNoXHJcbi8vIEphdmFzY3JpcHQgcGVyZm9ybXMgYml0LW9wZXJhdGlvbnMuICBGb3Igb3BlcmF0aW9ucyBsaWtlIGFkZGl0aW9uIGFuZFxyXG4vLyBtdWx0aXBsaWNhdGlvbiwgd2Ugc3BsaXQgZWFjaCBudW1iZXIgaW50byAxNiBiaXQgcGllY2VzLCB3aGljaCBjYW4gZWFzaWx5IGJlXHJcbi8vIG11bHRpcGxpZWQgd2l0aGluIEphdmFzY3JpcHQncyBmbG9hdGluZy1wb2ludCByZXByZXNlbnRhdGlvbiB3aXRob3V0IG92ZXJmbG93XHJcbi8vIG9yIGNoYW5nZSBpbiBzaWduLlxyXG4vL1xyXG4vLyBJbiB0aGUgYWxnb3JpdGhtcyBiZWxvdywgd2UgZnJlcXVlbnRseSByZWR1Y2UgdGhlIG5lZ2F0aXZlIGNhc2UgdG8gdGhlXHJcbi8vIHBvc2l0aXZlIGNhc2UgYnkgbmVnYXRpbmcgdGhlIGlucHV0KHMpIGFuZCB0aGVuIHBvc3QtcHJvY2Vzc2luZyB0aGUgcmVzdWx0LlxyXG4vLyBOb3RlIHRoYXQgd2UgbXVzdCBBTFdBWVMgY2hlY2sgc3BlY2lhbGx5IHdoZXRoZXIgdGhvc2UgdmFsdWVzIGFyZSBNSU5fVkFMVUVcclxuLy8gKC0yXjYzKSBiZWNhdXNlIC1NSU5fVkFMVUUgPT0gTUlOX1ZBTFVFIChzaW5jZSAyXjYzIGNhbm5vdCBiZSByZXByZXNlbnRlZCBhc1xyXG4vLyBhIHBvc2l0aXZlIG51bWJlciwgaXQgb3ZlcmZsb3dzIGJhY2sgaW50byBhIG5lZ2F0aXZlKS4gIE5vdCBoYW5kbGluZyB0aGlzXHJcbi8vIGNhc2Ugd291bGQgb2Z0ZW4gcmVzdWx0IGluIGluZmluaXRlIHJlY3Vyc2lvbi5cclxuLy9cclxuLy8gQ29tbW9uIGNvbnN0YW50IHZhbHVlcyBaRVJPLCBPTkUsIE5FR19PTkUsIGV0Yy4gYXJlIGRlZmluZWQgYmVsb3cgdGhlIGZyb20qXHJcbi8vIG1ldGhvZHMgb24gd2hpY2ggdGhleSBkZXBlbmQuXHJcblxyXG4vKipcclxuICogQW4gaW5kaWNhdG9yIHVzZWQgdG8gcmVsaWFibHkgZGV0ZXJtaW5lIGlmIGFuIG9iamVjdCBpcyBhIExvbmcgb3Igbm90LlxyXG4gKiBAdHlwZSB7Ym9vbGVhbn1cclxuICogQGNvbnN0XHJcbiAqIEBwcml2YXRlXHJcbiAqL1xyXG5Mb25nLnByb3RvdHlwZS5fX2lzTG9uZ19fO1xyXG5cclxuT2JqZWN0LmRlZmluZVByb3BlcnR5KExvbmcucHJvdG90eXBlLCBcIl9faXNMb25nX19cIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcclxuXHJcbi8qKlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHsqfSBvYmogT2JqZWN0XHJcbiAqIEByZXR1cm5zIHtib29sZWFufVxyXG4gKiBAaW5uZXJcclxuICovXHJcbmZ1bmN0aW9uIGlzTG9uZyhvYmopIHtcclxuICAgIHJldHVybiAob2JqICYmIG9ialtcIl9faXNMb25nX19cIl0pID09PSB0cnVlO1xyXG59XHJcblxyXG4vKipcclxuICogVGVzdHMgaWYgdGhlIHNwZWNpZmllZCBvYmplY3QgaXMgYSBMb25nLlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHsqfSBvYmogT2JqZWN0XHJcbiAqIEByZXR1cm5zIHtib29sZWFufVxyXG4gKi9cclxuTG9uZy5pc0xvbmcgPSBpc0xvbmc7XHJcblxyXG4vKipcclxuICogQSBjYWNoZSBvZiB0aGUgTG9uZyByZXByZXNlbnRhdGlvbnMgb2Ygc21hbGwgaW50ZWdlciB2YWx1ZXMuXHJcbiAqIEB0eXBlIHshT2JqZWN0fVxyXG4gKiBAaW5uZXJcclxuICovXHJcbnZhciBJTlRfQ0FDSEUgPSB7fTtcclxuXHJcbi8qKlxyXG4gKiBBIGNhY2hlIG9mIHRoZSBMb25nIHJlcHJlc2VudGF0aW9ucyBvZiBzbWFsbCB1bnNpZ25lZCBpbnRlZ2VyIHZhbHVlcy5cclxuICogQHR5cGUgeyFPYmplY3R9XHJcbiAqIEBpbm5lclxyXG4gKi9cclxudmFyIFVJTlRfQ0FDSEUgPSB7fTtcclxuXHJcbi8qKlxyXG4gKiBAcGFyYW0ge251bWJlcn0gdmFsdWVcclxuICogQHBhcmFtIHtib29sZWFuPX0gdW5zaWduZWRcclxuICogQHJldHVybnMgeyFMb25nfVxyXG4gKiBAaW5uZXJcclxuICovXHJcbmZ1bmN0aW9uIGZyb21JbnQodmFsdWUsIHVuc2lnbmVkKSB7XHJcbiAgICB2YXIgb2JqLCBjYWNoZWRPYmosIGNhY2hlO1xyXG4gICAgaWYgKHVuc2lnbmVkKSB7XHJcbiAgICAgICAgdmFsdWUgPj4+PSAwO1xyXG4gICAgICAgIGlmIChjYWNoZSA9ICgwIDw9IHZhbHVlICYmIHZhbHVlIDwgMjU2KSkge1xyXG4gICAgICAgICAgICBjYWNoZWRPYmogPSBVSU5UX0NBQ0hFW3ZhbHVlXTtcclxuICAgICAgICAgICAgaWYgKGNhY2hlZE9iailcclxuICAgICAgICAgICAgICAgIHJldHVybiBjYWNoZWRPYmo7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG9iaiA9IGZyb21CaXRzKHZhbHVlLCAodmFsdWUgfCAwKSA8IDAgPyAtMSA6IDAsIHRydWUpO1xyXG4gICAgICAgIGlmIChjYWNoZSlcclxuICAgICAgICAgICAgVUlOVF9DQUNIRVt2YWx1ZV0gPSBvYmo7XHJcbiAgICAgICAgcmV0dXJuIG9iajtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdmFsdWUgfD0gMDtcclxuICAgICAgICBpZiAoY2FjaGUgPSAoLTEyOCA8PSB2YWx1ZSAmJiB2YWx1ZSA8IDEyOCkpIHtcclxuICAgICAgICAgICAgY2FjaGVkT2JqID0gSU5UX0NBQ0hFW3ZhbHVlXTtcclxuICAgICAgICAgICAgaWYgKGNhY2hlZE9iailcclxuICAgICAgICAgICAgICAgIHJldHVybiBjYWNoZWRPYmo7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIG9iaiA9IGZyb21CaXRzKHZhbHVlLCB2YWx1ZSA8IDAgPyAtMSA6IDAsIGZhbHNlKTtcclxuICAgICAgICBpZiAoY2FjaGUpXHJcbiAgICAgICAgICAgIElOVF9DQUNIRVt2YWx1ZV0gPSBvYmo7XHJcbiAgICAgICAgcmV0dXJuIG9iajtcclxuICAgIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgYSBMb25nIHJlcHJlc2VudGluZyB0aGUgZ2l2ZW4gMzIgYml0IGludGVnZXIgdmFsdWUuXHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgVGhlIDMyIGJpdCBpbnRlZ2VyIGluIHF1ZXN0aW9uXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbj19IHVuc2lnbmVkIFdoZXRoZXIgdW5zaWduZWQgb3Igbm90LCBkZWZhdWx0cyB0byBzaWduZWRcclxuICogQHJldHVybnMgeyFMb25nfSBUaGUgY29ycmVzcG9uZGluZyBMb25nIHZhbHVlXHJcbiAqL1xyXG5Mb25nLmZyb21JbnQgPSBmcm9tSW50O1xyXG5cclxuLyoqXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZVxyXG4gKiBAcGFyYW0ge2Jvb2xlYW49fSB1bnNpZ25lZFxyXG4gKiBAcmV0dXJucyB7IUxvbmd9XHJcbiAqIEBpbm5lclxyXG4gKi9cclxuZnVuY3Rpb24gZnJvbU51bWJlcih2YWx1ZSwgdW5zaWduZWQpIHtcclxuICAgIGlmIChpc05hTih2YWx1ZSkpXHJcbiAgICAgICAgcmV0dXJuIHVuc2lnbmVkID8gVVpFUk8gOiBaRVJPO1xyXG4gICAgaWYgKHVuc2lnbmVkKSB7XHJcbiAgICAgICAgaWYgKHZhbHVlIDwgMClcclxuICAgICAgICAgICAgcmV0dXJuIFVaRVJPO1xyXG4gICAgICAgIGlmICh2YWx1ZSA+PSBUV09fUFdSXzY0X0RCTClcclxuICAgICAgICAgICAgcmV0dXJuIE1BWF9VTlNJR05FRF9WQUxVRTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKHZhbHVlIDw9IC1UV09fUFdSXzYzX0RCTClcclxuICAgICAgICAgICAgcmV0dXJuIE1JTl9WQUxVRTtcclxuICAgICAgICBpZiAodmFsdWUgKyAxID49IFRXT19QV1JfNjNfREJMKVxyXG4gICAgICAgICAgICByZXR1cm4gTUFYX1ZBTFVFO1xyXG4gICAgfVxyXG4gICAgaWYgKHZhbHVlIDwgMClcclxuICAgICAgICByZXR1cm4gZnJvbU51bWJlcigtdmFsdWUsIHVuc2lnbmVkKS5uZWcoKTtcclxuICAgIHJldHVybiBmcm9tQml0cygodmFsdWUgJSBUV09fUFdSXzMyX0RCTCkgfCAwLCAodmFsdWUgLyBUV09fUFdSXzMyX0RCTCkgfCAwLCB1bnNpZ25lZCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIGEgTG9uZyByZXByZXNlbnRpbmcgdGhlIGdpdmVuIHZhbHVlLCBwcm92aWRlZCB0aGF0IGl0IGlzIGEgZmluaXRlIG51bWJlci4gT3RoZXJ3aXNlLCB6ZXJvIGlzIHJldHVybmVkLlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIFRoZSBudW1iZXIgaW4gcXVlc3Rpb25cclxuICogQHBhcmFtIHtib29sZWFuPX0gdW5zaWduZWQgV2hldGhlciB1bnNpZ25lZCBvciBub3QsIGRlZmF1bHRzIHRvIHNpZ25lZFxyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFRoZSBjb3JyZXNwb25kaW5nIExvbmcgdmFsdWVcclxuICovXHJcbkxvbmcuZnJvbU51bWJlciA9IGZyb21OdW1iZXI7XHJcblxyXG4vKipcclxuICogQHBhcmFtIHtudW1iZXJ9IGxvd0JpdHNcclxuICogQHBhcmFtIHtudW1iZXJ9IGhpZ2hCaXRzXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbj19IHVuc2lnbmVkXHJcbiAqIEByZXR1cm5zIHshTG9uZ31cclxuICogQGlubmVyXHJcbiAqL1xyXG5mdW5jdGlvbiBmcm9tQml0cyhsb3dCaXRzLCBoaWdoQml0cywgdW5zaWduZWQpIHtcclxuICAgIHJldHVybiBuZXcgTG9uZyhsb3dCaXRzLCBoaWdoQml0cywgdW5zaWduZWQpO1xyXG59XHJcblxyXG4vKipcclxuICogUmV0dXJucyBhIExvbmcgcmVwcmVzZW50aW5nIHRoZSA2NCBiaXQgaW50ZWdlciB0aGF0IGNvbWVzIGJ5IGNvbmNhdGVuYXRpbmcgdGhlIGdpdmVuIGxvdyBhbmQgaGlnaCBiaXRzLiBFYWNoIGlzXHJcbiAqICBhc3N1bWVkIHRvIHVzZSAzMiBiaXRzLlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHtudW1iZXJ9IGxvd0JpdHMgVGhlIGxvdyAzMiBiaXRzXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBoaWdoQml0cyBUaGUgaGlnaCAzMiBiaXRzXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbj19IHVuc2lnbmVkIFdoZXRoZXIgdW5zaWduZWQgb3Igbm90LCBkZWZhdWx0cyB0byBzaWduZWRcclxuICogQHJldHVybnMgeyFMb25nfSBUaGUgY29ycmVzcG9uZGluZyBMb25nIHZhbHVlXHJcbiAqL1xyXG5Mb25nLmZyb21CaXRzID0gZnJvbUJpdHM7XHJcblxyXG4vKipcclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBiYXNlXHJcbiAqIEBwYXJhbSB7bnVtYmVyfSBleHBvbmVudFxyXG4gKiBAcmV0dXJucyB7bnVtYmVyfVxyXG4gKiBAaW5uZXJcclxuICovXHJcbnZhciBwb3dfZGJsID0gTWF0aC5wb3c7IC8vIFVzZWQgNCB0aW1lcyAoNCo4IHRvIDE1KzQpXHJcblxyXG4vKipcclxuICogQHBhcmFtIHtzdHJpbmd9IHN0clxyXG4gKiBAcGFyYW0geyhib29sZWFufG51bWJlcik9fSB1bnNpZ25lZFxyXG4gKiBAcGFyYW0ge251bWJlcj19IHJhZGl4XHJcbiAqIEByZXR1cm5zIHshTG9uZ31cclxuICogQGlubmVyXHJcbiAqL1xyXG5mdW5jdGlvbiBmcm9tU3RyaW5nKHN0ciwgdW5zaWduZWQsIHJhZGl4KSB7XHJcbiAgICBpZiAoc3RyLmxlbmd0aCA9PT0gMClcclxuICAgICAgICB0aHJvdyBFcnJvcignZW1wdHkgc3RyaW5nJyk7XHJcbiAgICBpZiAoc3RyID09PSBcIk5hTlwiIHx8IHN0ciA9PT0gXCJJbmZpbml0eVwiIHx8IHN0ciA9PT0gXCIrSW5maW5pdHlcIiB8fCBzdHIgPT09IFwiLUluZmluaXR5XCIpXHJcbiAgICAgICAgcmV0dXJuIFpFUk87XHJcbiAgICBpZiAodHlwZW9mIHVuc2lnbmVkID09PSAnbnVtYmVyJykge1xyXG4gICAgICAgIC8vIEZvciBnb29nLm1hdGgubG9uZyBjb21wYXRpYmlsaXR5XHJcbiAgICAgICAgcmFkaXggPSB1bnNpZ25lZCxcclxuICAgICAgICB1bnNpZ25lZCA9IGZhbHNlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgICB1bnNpZ25lZCA9ICEhIHVuc2lnbmVkO1xyXG4gICAgfVxyXG4gICAgcmFkaXggPSByYWRpeCB8fCAxMDtcclxuICAgIGlmIChyYWRpeCA8IDIgfHwgMzYgPCByYWRpeClcclxuICAgICAgICB0aHJvdyBSYW5nZUVycm9yKCdyYWRpeCcpO1xyXG5cclxuICAgIHZhciBwO1xyXG4gICAgaWYgKChwID0gc3RyLmluZGV4T2YoJy0nKSkgPiAwKVxyXG4gICAgICAgIHRocm93IEVycm9yKCdpbnRlcmlvciBoeXBoZW4nKTtcclxuICAgIGVsc2UgaWYgKHAgPT09IDApIHtcclxuICAgICAgICByZXR1cm4gZnJvbVN0cmluZyhzdHIuc3Vic3RyaW5nKDEpLCB1bnNpZ25lZCwgcmFkaXgpLm5lZygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERvIHNldmVyYWwgKDgpIGRpZ2l0cyBlYWNoIHRpbWUgdGhyb3VnaCB0aGUgbG9vcCwgc28gYXMgdG9cclxuICAgIC8vIG1pbmltaXplIHRoZSBjYWxscyB0byB0aGUgdmVyeSBleHBlbnNpdmUgZW11bGF0ZWQgZGl2LlxyXG4gICAgdmFyIHJhZGl4VG9Qb3dlciA9IGZyb21OdW1iZXIocG93X2RibChyYWRpeCwgOCkpO1xyXG5cclxuICAgIHZhciByZXN1bHQgPSBaRVJPO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpICs9IDgpIHtcclxuICAgICAgICB2YXIgc2l6ZSA9IE1hdGgubWluKDgsIHN0ci5sZW5ndGggLSBpKSxcclxuICAgICAgICAgICAgdmFsdWUgPSBwYXJzZUludChzdHIuc3Vic3RyaW5nKGksIGkgKyBzaXplKSwgcmFkaXgpO1xyXG4gICAgICAgIGlmIChzaXplIDwgOCkge1xyXG4gICAgICAgICAgICB2YXIgcG93ZXIgPSBmcm9tTnVtYmVyKHBvd19kYmwocmFkaXgsIHNpemUpKTtcclxuICAgICAgICAgICAgcmVzdWx0ID0gcmVzdWx0Lm11bChwb3dlcikuYWRkKGZyb21OdW1iZXIodmFsdWUpKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICByZXN1bHQgPSByZXN1bHQubXVsKHJhZGl4VG9Qb3dlcik7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9IHJlc3VsdC5hZGQoZnJvbU51bWJlcih2YWx1ZSkpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJlc3VsdC51bnNpZ25lZCA9IHVuc2lnbmVkO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgYSBMb25nIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBnaXZlbiBzdHJpbmcsIHdyaXR0ZW4gdXNpbmcgdGhlIHNwZWNpZmllZCByYWRpeC5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBzdHIgVGhlIHRleHR1YWwgcmVwcmVzZW50YXRpb24gb2YgdGhlIExvbmdcclxuICogQHBhcmFtIHsoYm9vbGVhbnxudW1iZXIpPX0gdW5zaWduZWQgV2hldGhlciB1bnNpZ25lZCBvciBub3QsIGRlZmF1bHRzIHRvIHNpZ25lZFxyXG4gKiBAcGFyYW0ge251bWJlcj19IHJhZGl4IFRoZSByYWRpeCBpbiB3aGljaCB0aGUgdGV4dCBpcyB3cml0dGVuICgyLTM2KSwgZGVmYXVsdHMgdG8gMTBcclxuICogQHJldHVybnMgeyFMb25nfSBUaGUgY29ycmVzcG9uZGluZyBMb25nIHZhbHVlXHJcbiAqL1xyXG5Mb25nLmZyb21TdHJpbmcgPSBmcm9tU3RyaW5nO1xyXG5cclxuLyoqXHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd8IXtsb3c6IG51bWJlciwgaGlnaDogbnVtYmVyLCB1bnNpZ25lZDogYm9vbGVhbn19IHZhbFxyXG4gKiBAcGFyYW0ge2Jvb2xlYW49fSB1bnNpZ25lZFxyXG4gKiBAcmV0dXJucyB7IUxvbmd9XHJcbiAqIEBpbm5lclxyXG4gKi9cclxuZnVuY3Rpb24gZnJvbVZhbHVlKHZhbCwgdW5zaWduZWQpIHtcclxuICAgIGlmICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJylcclxuICAgICAgICByZXR1cm4gZnJvbU51bWJlcih2YWwsIHVuc2lnbmVkKTtcclxuICAgIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJylcclxuICAgICAgICByZXR1cm4gZnJvbVN0cmluZyh2YWwsIHVuc2lnbmVkKTtcclxuICAgIC8vIFRocm93cyBmb3Igbm9uLW9iamVjdHMsIGNvbnZlcnRzIG5vbi1pbnN0YW5jZW9mIExvbmc6XHJcbiAgICByZXR1cm4gZnJvbUJpdHModmFsLmxvdywgdmFsLmhpZ2gsIHR5cGVvZiB1bnNpZ25lZCA9PT0gJ2Jvb2xlYW4nID8gdW5zaWduZWQgOiB2YWwudW5zaWduZWQpO1xyXG59XHJcblxyXG4vKipcclxuICogQ29udmVydHMgdGhlIHNwZWNpZmllZCB2YWx1ZSB0byBhIExvbmcgdXNpbmcgdGhlIGFwcHJvcHJpYXRlIGZyb20qIGZ1bmN0aW9uIGZvciBpdHMgdHlwZS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ3whe2xvdzogbnVtYmVyLCBoaWdoOiBudW1iZXIsIHVuc2lnbmVkOiBib29sZWFufX0gdmFsIFZhbHVlXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbj19IHVuc2lnbmVkIFdoZXRoZXIgdW5zaWduZWQgb3Igbm90LCBkZWZhdWx0cyB0byBzaWduZWRcclxuICogQHJldHVybnMgeyFMb25nfVxyXG4gKi9cclxuTG9uZy5mcm9tVmFsdWUgPSBmcm9tVmFsdWU7XHJcblxyXG4vLyBOT1RFOiB0aGUgY29tcGlsZXIgc2hvdWxkIGlubGluZSB0aGVzZSBjb25zdGFudCB2YWx1ZXMgYmVsb3cgYW5kIHRoZW4gcmVtb3ZlIHRoZXNlIHZhcmlhYmxlcywgc28gdGhlcmUgc2hvdWxkIGJlXHJcbi8vIG5vIHJ1bnRpbWUgcGVuYWx0eSBmb3IgdGhlc2UuXHJcblxyXG4vKipcclxuICogQHR5cGUge251bWJlcn1cclxuICogQGNvbnN0XHJcbiAqIEBpbm5lclxyXG4gKi9cclxudmFyIFRXT19QV1JfMTZfREJMID0gMSA8PCAxNjtcclxuXHJcbi8qKlxyXG4gKiBAdHlwZSB7bnVtYmVyfVxyXG4gKiBAY29uc3RcclxuICogQGlubmVyXHJcbiAqL1xyXG52YXIgVFdPX1BXUl8yNF9EQkwgPSAxIDw8IDI0O1xyXG5cclxuLyoqXHJcbiAqIEB0eXBlIHtudW1iZXJ9XHJcbiAqIEBjb25zdFxyXG4gKiBAaW5uZXJcclxuICovXHJcbnZhciBUV09fUFdSXzMyX0RCTCA9IFRXT19QV1JfMTZfREJMICogVFdPX1BXUl8xNl9EQkw7XHJcblxyXG4vKipcclxuICogQHR5cGUge251bWJlcn1cclxuICogQGNvbnN0XHJcbiAqIEBpbm5lclxyXG4gKi9cclxudmFyIFRXT19QV1JfNjRfREJMID0gVFdPX1BXUl8zMl9EQkwgKiBUV09fUFdSXzMyX0RCTDtcclxuXHJcbi8qKlxyXG4gKiBAdHlwZSB7bnVtYmVyfVxyXG4gKiBAY29uc3RcclxuICogQGlubmVyXHJcbiAqL1xyXG52YXIgVFdPX1BXUl82M19EQkwgPSBUV09fUFdSXzY0X0RCTCAvIDI7XHJcblxyXG4vKipcclxuICogQHR5cGUgeyFMb25nfVxyXG4gKiBAY29uc3RcclxuICogQGlubmVyXHJcbiAqL1xyXG52YXIgVFdPX1BXUl8yNCA9IGZyb21JbnQoVFdPX1BXUl8yNF9EQkwpO1xyXG5cclxuLyoqXHJcbiAqIEB0eXBlIHshTG9uZ31cclxuICogQGlubmVyXHJcbiAqL1xyXG52YXIgWkVSTyA9IGZyb21JbnQoMCk7XHJcblxyXG4vKipcclxuICogU2lnbmVkIHplcm8uXHJcbiAqIEB0eXBlIHshTG9uZ31cclxuICovXHJcbkxvbmcuWkVSTyA9IFpFUk87XHJcblxyXG4vKipcclxuICogQHR5cGUgeyFMb25nfVxyXG4gKiBAaW5uZXJcclxuICovXHJcbnZhciBVWkVSTyA9IGZyb21JbnQoMCwgdHJ1ZSk7XHJcblxyXG4vKipcclxuICogVW5zaWduZWQgemVyby5cclxuICogQHR5cGUgeyFMb25nfVxyXG4gKi9cclxuTG9uZy5VWkVSTyA9IFVaRVJPO1xyXG5cclxuLyoqXHJcbiAqIEB0eXBlIHshTG9uZ31cclxuICogQGlubmVyXHJcbiAqL1xyXG52YXIgT05FID0gZnJvbUludCgxKTtcclxuXHJcbi8qKlxyXG4gKiBTaWduZWQgb25lLlxyXG4gKiBAdHlwZSB7IUxvbmd9XHJcbiAqL1xyXG5Mb25nLk9ORSA9IE9ORTtcclxuXHJcbi8qKlxyXG4gKiBAdHlwZSB7IUxvbmd9XHJcbiAqIEBpbm5lclxyXG4gKi9cclxudmFyIFVPTkUgPSBmcm9tSW50KDEsIHRydWUpO1xyXG5cclxuLyoqXHJcbiAqIFVuc2lnbmVkIG9uZS5cclxuICogQHR5cGUgeyFMb25nfVxyXG4gKi9cclxuTG9uZy5VT05FID0gVU9ORTtcclxuXHJcbi8qKlxyXG4gKiBAdHlwZSB7IUxvbmd9XHJcbiAqIEBpbm5lclxyXG4gKi9cclxudmFyIE5FR19PTkUgPSBmcm9tSW50KC0xKTtcclxuXHJcbi8qKlxyXG4gKiBTaWduZWQgbmVnYXRpdmUgb25lLlxyXG4gKiBAdHlwZSB7IUxvbmd9XHJcbiAqL1xyXG5Mb25nLk5FR19PTkUgPSBORUdfT05FO1xyXG5cclxuLyoqXHJcbiAqIEB0eXBlIHshTG9uZ31cclxuICogQGlubmVyXHJcbiAqL1xyXG52YXIgTUFYX1ZBTFVFID0gZnJvbUJpdHMoMHhGRkZGRkZGRnwwLCAweDdGRkZGRkZGfDAsIGZhbHNlKTtcclxuXHJcbi8qKlxyXG4gKiBNYXhpbXVtIHNpZ25lZCB2YWx1ZS5cclxuICogQHR5cGUgeyFMb25nfVxyXG4gKi9cclxuTG9uZy5NQVhfVkFMVUUgPSBNQVhfVkFMVUU7XHJcblxyXG4vKipcclxuICogQHR5cGUgeyFMb25nfVxyXG4gKiBAaW5uZXJcclxuICovXHJcbnZhciBNQVhfVU5TSUdORURfVkFMVUUgPSBmcm9tQml0cygweEZGRkZGRkZGfDAsIDB4RkZGRkZGRkZ8MCwgdHJ1ZSk7XHJcblxyXG4vKipcclxuICogTWF4aW11bSB1bnNpZ25lZCB2YWx1ZS5cclxuICogQHR5cGUgeyFMb25nfVxyXG4gKi9cclxuTG9uZy5NQVhfVU5TSUdORURfVkFMVUUgPSBNQVhfVU5TSUdORURfVkFMVUU7XHJcblxyXG4vKipcclxuICogQHR5cGUgeyFMb25nfVxyXG4gKiBAaW5uZXJcclxuICovXHJcbnZhciBNSU5fVkFMVUUgPSBmcm9tQml0cygwLCAweDgwMDAwMDAwfDAsIGZhbHNlKTtcclxuXHJcbi8qKlxyXG4gKiBNaW5pbXVtIHNpZ25lZCB2YWx1ZS5cclxuICogQHR5cGUgeyFMb25nfVxyXG4gKi9cclxuTG9uZy5NSU5fVkFMVUUgPSBNSU5fVkFMVUU7XHJcblxyXG4vKipcclxuICogQGFsaWFzIExvbmcucHJvdG90eXBlXHJcbiAqIEBpbm5lclxyXG4gKi9cclxudmFyIExvbmdQcm90b3R5cGUgPSBMb25nLnByb3RvdHlwZTtcclxuXHJcbi8qKlxyXG4gKiBDb252ZXJ0cyB0aGUgTG9uZyB0byBhIDMyIGJpdCBpbnRlZ2VyLCBhc3N1bWluZyBpdCBpcyBhIDMyIGJpdCBpbnRlZ2VyLlxyXG4gKiBAcmV0dXJucyB7bnVtYmVyfVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS50b0ludCA9IGZ1bmN0aW9uIHRvSW50KCkge1xyXG4gICAgcmV0dXJuIHRoaXMudW5zaWduZWQgPyB0aGlzLmxvdyA+Pj4gMCA6IHRoaXMubG93O1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbnZlcnRzIHRoZSBMb25nIHRvIGEgdGhlIG5lYXJlc3QgZmxvYXRpbmctcG9pbnQgcmVwcmVzZW50YXRpb24gb2YgdGhpcyB2YWx1ZSAoZG91YmxlLCA1MyBiaXQgbWFudGlzc2EpLlxyXG4gKiBAcmV0dXJucyB7bnVtYmVyfVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS50b051bWJlciA9IGZ1bmN0aW9uIHRvTnVtYmVyKCkge1xyXG4gICAgaWYgKHRoaXMudW5zaWduZWQpXHJcbiAgICAgICAgcmV0dXJuICgodGhpcy5oaWdoID4+PiAwKSAqIFRXT19QV1JfMzJfREJMKSArICh0aGlzLmxvdyA+Pj4gMCk7XHJcbiAgICByZXR1cm4gdGhpcy5oaWdoICogVFdPX1BXUl8zMl9EQkwgKyAodGhpcy5sb3cgPj4+IDApO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbnZlcnRzIHRoZSBMb25nIHRvIGEgc3RyaW5nIHdyaXR0ZW4gaW4gdGhlIHNwZWNpZmllZCByYWRpeC5cclxuICogQHBhcmFtIHtudW1iZXI9fSByYWRpeCBSYWRpeCAoMi0zNiksIGRlZmF1bHRzIHRvIDEwXHJcbiAqIEByZXR1cm5zIHtzdHJpbmd9XHJcbiAqIEBvdmVycmlkZVxyXG4gKiBAdGhyb3dzIHtSYW5nZUVycm9yfSBJZiBgcmFkaXhgIGlzIG91dCBvZiByYW5nZVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIHRvU3RyaW5nKHJhZGl4KSB7XHJcbiAgICByYWRpeCA9IHJhZGl4IHx8IDEwO1xyXG4gICAgaWYgKHJhZGl4IDwgMiB8fCAzNiA8IHJhZGl4KVxyXG4gICAgICAgIHRocm93IFJhbmdlRXJyb3IoJ3JhZGl4Jyk7XHJcbiAgICBpZiAodGhpcy5pc1plcm8oKSlcclxuICAgICAgICByZXR1cm4gJzAnO1xyXG4gICAgaWYgKHRoaXMuaXNOZWdhdGl2ZSgpKSB7IC8vIFVuc2lnbmVkIExvbmdzIGFyZSBuZXZlciBuZWdhdGl2ZVxyXG4gICAgICAgIGlmICh0aGlzLmVxKE1JTl9WQUxVRSkpIHtcclxuICAgICAgICAgICAgLy8gV2UgbmVlZCB0byBjaGFuZ2UgdGhlIExvbmcgdmFsdWUgYmVmb3JlIGl0IGNhbiBiZSBuZWdhdGVkLCBzbyB3ZSByZW1vdmVcclxuICAgICAgICAgICAgLy8gdGhlIGJvdHRvbS1tb3N0IGRpZ2l0IGluIHRoaXMgYmFzZSBhbmQgdGhlbiByZWN1cnNlIHRvIGRvIHRoZSByZXN0LlxyXG4gICAgICAgICAgICB2YXIgcmFkaXhMb25nID0gZnJvbU51bWJlcihyYWRpeCksXHJcbiAgICAgICAgICAgICAgICBkaXYgPSB0aGlzLmRpdihyYWRpeExvbmcpLFxyXG4gICAgICAgICAgICAgICAgcmVtMSA9IGRpdi5tdWwocmFkaXhMb25nKS5zdWIodGhpcyk7XHJcbiAgICAgICAgICAgIHJldHVybiBkaXYudG9TdHJpbmcocmFkaXgpICsgcmVtMS50b0ludCgpLnRvU3RyaW5nKHJhZGl4KTtcclxuICAgICAgICB9IGVsc2VcclxuICAgICAgICAgICAgcmV0dXJuICctJyArIHRoaXMubmVnKCkudG9TdHJpbmcocmFkaXgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERvIHNldmVyYWwgKDYpIGRpZ2l0cyBlYWNoIHRpbWUgdGhyb3VnaCB0aGUgbG9vcCwgc28gYXMgdG9cclxuICAgIC8vIG1pbmltaXplIHRoZSBjYWxscyB0byB0aGUgdmVyeSBleHBlbnNpdmUgZW11bGF0ZWQgZGl2LlxyXG4gICAgdmFyIHJhZGl4VG9Qb3dlciA9IGZyb21OdW1iZXIocG93X2RibChyYWRpeCwgNiksIHRoaXMudW5zaWduZWQpLFxyXG4gICAgICAgIHJlbSA9IHRoaXM7XHJcbiAgICB2YXIgcmVzdWx0ID0gJyc7XHJcbiAgICB3aGlsZSAodHJ1ZSkge1xyXG4gICAgICAgIHZhciByZW1EaXYgPSByZW0uZGl2KHJhZGl4VG9Qb3dlciksXHJcbiAgICAgICAgICAgIGludHZhbCA9IHJlbS5zdWIocmVtRGl2Lm11bChyYWRpeFRvUG93ZXIpKS50b0ludCgpID4+PiAwLFxyXG4gICAgICAgICAgICBkaWdpdHMgPSBpbnR2YWwudG9TdHJpbmcocmFkaXgpO1xyXG4gICAgICAgIHJlbSA9IHJlbURpdjtcclxuICAgICAgICBpZiAocmVtLmlzWmVybygpKVxyXG4gICAgICAgICAgICByZXR1cm4gZGlnaXRzICsgcmVzdWx0O1xyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICB3aGlsZSAoZGlnaXRzLmxlbmd0aCA8IDYpXHJcbiAgICAgICAgICAgICAgICBkaWdpdHMgPSAnMCcgKyBkaWdpdHM7XHJcbiAgICAgICAgICAgIHJlc3VsdCA9ICcnICsgZGlnaXRzICsgcmVzdWx0O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBoaWdoIDMyIGJpdHMgYXMgYSBzaWduZWQgaW50ZWdlci5cclxuICogQHJldHVybnMge251bWJlcn0gU2lnbmVkIGhpZ2ggYml0c1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5nZXRIaWdoQml0cyA9IGZ1bmN0aW9uIGdldEhpZ2hCaXRzKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaGlnaDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBoaWdoIDMyIGJpdHMgYXMgYW4gdW5zaWduZWQgaW50ZWdlci5cclxuICogQHJldHVybnMge251bWJlcn0gVW5zaWduZWQgaGlnaCBiaXRzXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmdldEhpZ2hCaXRzVW5zaWduZWQgPSBmdW5jdGlvbiBnZXRIaWdoQml0c1Vuc2lnbmVkKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaGlnaCA+Pj4gMDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBHZXRzIHRoZSBsb3cgMzIgYml0cyBhcyBhIHNpZ25lZCBpbnRlZ2VyLlxyXG4gKiBAcmV0dXJucyB7bnVtYmVyfSBTaWduZWQgbG93IGJpdHNcclxuICovXHJcbkxvbmdQcm90b3R5cGUuZ2V0TG93Qml0cyA9IGZ1bmN0aW9uIGdldExvd0JpdHMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5sb3c7XHJcbn07XHJcblxyXG4vKipcclxuICogR2V0cyB0aGUgbG93IDMyIGJpdHMgYXMgYW4gdW5zaWduZWQgaW50ZWdlci5cclxuICogQHJldHVybnMge251bWJlcn0gVW5zaWduZWQgbG93IGJpdHNcclxuICovXHJcbkxvbmdQcm90b3R5cGUuZ2V0TG93Qml0c1Vuc2lnbmVkID0gZnVuY3Rpb24gZ2V0TG93Qml0c1Vuc2lnbmVkKCkge1xyXG4gICAgcmV0dXJuIHRoaXMubG93ID4+PiAwO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIEdldHMgdGhlIG51bWJlciBvZiBiaXRzIG5lZWRlZCB0byByZXByZXNlbnQgdGhlIGFic29sdXRlIHZhbHVlIG9mIHRoaXMgTG9uZy5cclxuICogQHJldHVybnMge251bWJlcn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUuZ2V0TnVtQml0c0FicyA9IGZ1bmN0aW9uIGdldE51bUJpdHNBYnMoKSB7XHJcbiAgICBpZiAodGhpcy5pc05lZ2F0aXZlKCkpIC8vIFVuc2lnbmVkIExvbmdzIGFyZSBuZXZlciBuZWdhdGl2ZVxyXG4gICAgICAgIHJldHVybiB0aGlzLmVxKE1JTl9WQUxVRSkgPyA2NCA6IHRoaXMubmVnKCkuZ2V0TnVtQml0c0FicygpO1xyXG4gICAgdmFyIHZhbCA9IHRoaXMuaGlnaCAhPSAwID8gdGhpcy5oaWdoIDogdGhpcy5sb3c7XHJcbiAgICBmb3IgKHZhciBiaXQgPSAzMTsgYml0ID4gMDsgYml0LS0pXHJcbiAgICAgICAgaWYgKCh2YWwgJiAoMSA8PCBiaXQpKSAhPSAwKVxyXG4gICAgICAgICAgICBicmVhaztcclxuICAgIHJldHVybiB0aGlzLmhpZ2ggIT0gMCA/IGJpdCArIDMzIDogYml0ICsgMTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBlcXVhbHMgemVyby5cclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmlzWmVybyA9IGZ1bmN0aW9uIGlzWmVybygpIHtcclxuICAgIHJldHVybiB0aGlzLmhpZ2ggPT09IDAgJiYgdGhpcy5sb3cgPT09IDA7XHJcbn07XHJcblxyXG4vKipcclxuICogVGVzdHMgaWYgdGhpcyBMb25nJ3MgdmFsdWUgZXF1YWxzIHplcm8uIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjaXNaZXJvfS5cclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmVxeiA9IExvbmdQcm90b3R5cGUuaXNaZXJvO1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGlzIG5lZ2F0aXZlLlxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUuaXNOZWdhdGl2ZSA9IGZ1bmN0aW9uIGlzTmVnYXRpdmUoKSB7XHJcbiAgICByZXR1cm4gIXRoaXMudW5zaWduZWQgJiYgdGhpcy5oaWdoIDwgMDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBpcyBwb3NpdGl2ZS5cclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmlzUG9zaXRpdmUgPSBmdW5jdGlvbiBpc1Bvc2l0aXZlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudW5zaWduZWQgfHwgdGhpcy5oaWdoID49IDA7XHJcbn07XHJcblxyXG4vKipcclxuICogVGVzdHMgaWYgdGhpcyBMb25nJ3MgdmFsdWUgaXMgb2RkLlxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUuaXNPZGQgPSBmdW5jdGlvbiBpc09kZCgpIHtcclxuICAgIHJldHVybiAodGhpcy5sb3cgJiAxKSA9PT0gMTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBpcyBldmVuLlxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUuaXNFdmVuID0gZnVuY3Rpb24gaXNFdmVuKCkge1xyXG4gICAgcmV0dXJuICh0aGlzLmxvdyAmIDEpID09PSAwO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGVxdWFscyB0aGUgc3BlY2lmaWVkJ3MuXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIGVxdWFscyhvdGhlcikge1xyXG4gICAgaWYgKCFpc0xvbmcob3RoZXIpKVxyXG4gICAgICAgIG90aGVyID0gZnJvbVZhbHVlKG90aGVyKTtcclxuICAgIGlmICh0aGlzLnVuc2lnbmVkICE9PSBvdGhlci51bnNpZ25lZCAmJiAodGhpcy5oaWdoID4+PiAzMSkgPT09IDEgJiYgKG90aGVyLmhpZ2ggPj4+IDMxKSA9PT0gMSlcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdGhpcy5oaWdoID09PSBvdGhlci5oaWdoICYmIHRoaXMubG93ID09PSBvdGhlci5sb3c7XHJcbn07XHJcblxyXG4vKipcclxuICogVGVzdHMgaWYgdGhpcyBMb25nJ3MgdmFsdWUgZXF1YWxzIHRoZSBzcGVjaWZpZWQncy4gVGhpcyBpcyBhbiBhbGlhcyBvZiB7QGxpbmsgTG9uZyNlcXVhbHN9LlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBvdGhlciBPdGhlciB2YWx1ZVxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUuZXEgPSBMb25nUHJvdG90eXBlLmVxdWFscztcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBkaWZmZXJzIGZyb20gdGhlIHNwZWNpZmllZCdzLlxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd9IG90aGVyIE90aGVyIHZhbHVlXHJcbiAqIEByZXR1cm5zIHtib29sZWFufVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5ub3RFcXVhbHMgPSBmdW5jdGlvbiBub3RFcXVhbHMob3RoZXIpIHtcclxuICAgIHJldHVybiAhdGhpcy5lcSgvKiB2YWxpZGF0ZXMgKi8gb3RoZXIpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGRpZmZlcnMgZnJvbSB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjbm90RXF1YWxzfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLm5lcSA9IExvbmdQcm90b3R5cGUubm90RXF1YWxzO1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGRpZmZlcnMgZnJvbSB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjbm90RXF1YWxzfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLm5lID0gTG9uZ1Byb3RvdHlwZS5ub3RFcXVhbHM7XHJcblxyXG4vKipcclxuICogVGVzdHMgaWYgdGhpcyBMb25nJ3MgdmFsdWUgaXMgbGVzcyB0aGFuIHRoZSBzcGVjaWZpZWQncy5cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBvdGhlciBPdGhlciB2YWx1ZVxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbiBsZXNzVGhhbihvdGhlcikge1xyXG4gICAgcmV0dXJuIHRoaXMuY29tcCgvKiB2YWxpZGF0ZXMgKi8gb3RoZXIpIDwgMDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBpcyBsZXNzIHRoYW4gdGhlIHNwZWNpZmllZCdzLiBUaGlzIGlzIGFuIGFsaWFzIG9mIHtAbGluayBMb25nI2xlc3NUaGFufS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmx0ID0gTG9uZ1Byb3RvdHlwZS5sZXNzVGhhbjtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBpcyBsZXNzIHRoYW4gb3IgZXF1YWwgdGhlIHNwZWNpZmllZCdzLlxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd9IG90aGVyIE90aGVyIHZhbHVlXHJcbiAqIEByZXR1cm5zIHtib29sZWFufVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbiBsZXNzVGhhbk9yRXF1YWwob3RoZXIpIHtcclxuICAgIHJldHVybiB0aGlzLmNvbXAoLyogdmFsaWRhdGVzICovIG90aGVyKSA8PSAwO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGlzIGxlc3MgdGhhbiBvciBlcXVhbCB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjbGVzc1RoYW5PckVxdWFsfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmx0ZSA9IExvbmdQcm90b3R5cGUubGVzc1RoYW5PckVxdWFsO1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGlzIGxlc3MgdGhhbiBvciBlcXVhbCB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjbGVzc1RoYW5PckVxdWFsfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmxlID0gTG9uZ1Byb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWw7XHJcblxyXG4vKipcclxuICogVGVzdHMgaWYgdGhpcyBMb25nJ3MgdmFsdWUgaXMgZ3JlYXRlciB0aGFuIHRoZSBzcGVjaWZpZWQncy5cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBvdGhlciBPdGhlciB2YWx1ZVxyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn1cclxuICovXHJcbkxvbmdQcm90b3R5cGUuZ3JlYXRlclRoYW4gPSBmdW5jdGlvbiBncmVhdGVyVGhhbihvdGhlcikge1xyXG4gICAgcmV0dXJuIHRoaXMuY29tcCgvKiB2YWxpZGF0ZXMgKi8gb3RoZXIpID4gMDtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBpcyBncmVhdGVyIHRoYW4gdGhlIHNwZWNpZmllZCdzLiBUaGlzIGlzIGFuIGFsaWFzIG9mIHtAbGluayBMb25nI2dyZWF0ZXJUaGFufS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmd0ID0gTG9uZ1Byb3RvdHlwZS5ncmVhdGVyVGhhbjtcclxuXHJcbi8qKlxyXG4gKiBUZXN0cyBpZiB0aGlzIExvbmcncyB2YWx1ZSBpcyBncmVhdGVyIHRoYW4gb3IgZXF1YWwgdGhlIHNwZWNpZmllZCdzLlxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd9IG90aGVyIE90aGVyIHZhbHVlXHJcbiAqIEByZXR1cm5zIHtib29sZWFufVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWwgPSBmdW5jdGlvbiBncmVhdGVyVGhhbk9yRXF1YWwob3RoZXIpIHtcclxuICAgIHJldHVybiB0aGlzLmNvbXAoLyogdmFsaWRhdGVzICovIG90aGVyKSA+PSAwO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGlzIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjZ3JlYXRlclRoYW5PckVxdWFsfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmd0ZSA9IExvbmdQcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsO1xyXG5cclxuLyoqXHJcbiAqIFRlc3RzIGlmIHRoaXMgTG9uZydzIHZhbHVlIGlzIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjZ3JlYXRlclRoYW5PckVxdWFsfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge2Jvb2xlYW59XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmdlID0gTG9uZ1Byb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWw7XHJcblxyXG4vKipcclxuICogQ29tcGFyZXMgdGhpcyBMb25nJ3MgdmFsdWUgd2l0aCB0aGUgc3BlY2lmaWVkJ3MuXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgdmFsdWVcclxuICogQHJldHVybnMge251bWJlcn0gMCBpZiB0aGV5IGFyZSB0aGUgc2FtZSwgMSBpZiB0aGUgdGhpcyBpcyBncmVhdGVyIGFuZCAtMVxyXG4gKiAgaWYgdGhlIGdpdmVuIG9uZSBpcyBncmVhdGVyXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlKG90aGVyKSB7XHJcbiAgICBpZiAoIWlzTG9uZyhvdGhlcikpXHJcbiAgICAgICAgb3RoZXIgPSBmcm9tVmFsdWUob3RoZXIpO1xyXG4gICAgaWYgKHRoaXMuZXEob3RoZXIpKVxyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgdmFyIHRoaXNOZWcgPSB0aGlzLmlzTmVnYXRpdmUoKSxcclxuICAgICAgICBvdGhlck5lZyA9IG90aGVyLmlzTmVnYXRpdmUoKTtcclxuICAgIGlmICh0aGlzTmVnICYmICFvdGhlck5lZylcclxuICAgICAgICByZXR1cm4gLTE7XHJcbiAgICBpZiAoIXRoaXNOZWcgJiYgb3RoZXJOZWcpXHJcbiAgICAgICAgcmV0dXJuIDE7XHJcbiAgICAvLyBBdCB0aGlzIHBvaW50IHRoZSBzaWduIGJpdHMgYXJlIHRoZSBzYW1lXHJcbiAgICBpZiAoIXRoaXMudW5zaWduZWQpXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuc3ViKG90aGVyKS5pc05lZ2F0aXZlKCkgPyAtMSA6IDE7XHJcbiAgICAvLyBCb3RoIGFyZSBwb3NpdGl2ZSBpZiBhdCBsZWFzdCBvbmUgaXMgdW5zaWduZWRcclxuICAgIHJldHVybiAob3RoZXIuaGlnaCA+Pj4gMCkgPiAodGhpcy5oaWdoID4+PiAwKSB8fCAob3RoZXIuaGlnaCA9PT0gdGhpcy5oaWdoICYmIChvdGhlci5sb3cgPj4+IDApID4gKHRoaXMubG93ID4+PiAwKSkgPyAtMSA6IDE7XHJcbn07XHJcblxyXG4vKipcclxuICogQ29tcGFyZXMgdGhpcyBMb25nJ3MgdmFsdWUgd2l0aCB0aGUgc3BlY2lmaWVkJ3MuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjY29tcGFyZX0uXHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd9IG90aGVyIE90aGVyIHZhbHVlXHJcbiAqIEByZXR1cm5zIHtudW1iZXJ9IDAgaWYgdGhleSBhcmUgdGhlIHNhbWUsIDEgaWYgdGhlIHRoaXMgaXMgZ3JlYXRlciBhbmQgLTFcclxuICogIGlmIHRoZSBnaXZlbiBvbmUgaXMgZ3JlYXRlclxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5jb21wID0gTG9uZ1Byb3RvdHlwZS5jb21wYXJlO1xyXG5cclxuLyoqXHJcbiAqIE5lZ2F0ZXMgdGhpcyBMb25nJ3MgdmFsdWUuXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gTmVnYXRlZCBMb25nXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLm5lZ2F0ZSA9IGZ1bmN0aW9uIG5lZ2F0ZSgpIHtcclxuICAgIGlmICghdGhpcy51bnNpZ25lZCAmJiB0aGlzLmVxKE1JTl9WQUxVRSkpXHJcbiAgICAgICAgcmV0dXJuIE1JTl9WQUxVRTtcclxuICAgIHJldHVybiB0aGlzLm5vdCgpLmFkZChPTkUpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIE5lZ2F0ZXMgdGhpcyBMb25nJ3MgdmFsdWUuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjbmVnYXRlfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gTmVnYXRlZCBMb25nXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLm5lZyA9IExvbmdQcm90b3R5cGUubmVnYXRlO1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhlIHN1bSBvZiB0aGlzIGFuZCB0aGUgc3BlY2lmaWVkIExvbmcuXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gYWRkZW5kIEFkZGVuZFxyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFN1bVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5hZGQgPSBmdW5jdGlvbiBhZGQoYWRkZW5kKSB7XHJcbiAgICBpZiAoIWlzTG9uZyhhZGRlbmQpKVxyXG4gICAgICAgIGFkZGVuZCA9IGZyb21WYWx1ZShhZGRlbmQpO1xyXG5cclxuICAgIC8vIERpdmlkZSBlYWNoIG51bWJlciBpbnRvIDQgY2h1bmtzIG9mIDE2IGJpdHMsIGFuZCB0aGVuIHN1bSB0aGUgY2h1bmtzLlxyXG5cclxuICAgIHZhciBhNDggPSB0aGlzLmhpZ2ggPj4+IDE2O1xyXG4gICAgdmFyIGEzMiA9IHRoaXMuaGlnaCAmIDB4RkZGRjtcclxuICAgIHZhciBhMTYgPSB0aGlzLmxvdyA+Pj4gMTY7XHJcbiAgICB2YXIgYTAwID0gdGhpcy5sb3cgJiAweEZGRkY7XHJcblxyXG4gICAgdmFyIGI0OCA9IGFkZGVuZC5oaWdoID4+PiAxNjtcclxuICAgIHZhciBiMzIgPSBhZGRlbmQuaGlnaCAmIDB4RkZGRjtcclxuICAgIHZhciBiMTYgPSBhZGRlbmQubG93ID4+PiAxNjtcclxuICAgIHZhciBiMDAgPSBhZGRlbmQubG93ICYgMHhGRkZGO1xyXG5cclxuICAgIHZhciBjNDggPSAwLCBjMzIgPSAwLCBjMTYgPSAwLCBjMDAgPSAwO1xyXG4gICAgYzAwICs9IGEwMCArIGIwMDtcclxuICAgIGMxNiArPSBjMDAgPj4+IDE2O1xyXG4gICAgYzAwICY9IDB4RkZGRjtcclxuICAgIGMxNiArPSBhMTYgKyBiMTY7XHJcbiAgICBjMzIgKz0gYzE2ID4+PiAxNjtcclxuICAgIGMxNiAmPSAweEZGRkY7XHJcbiAgICBjMzIgKz0gYTMyICsgYjMyO1xyXG4gICAgYzQ4ICs9IGMzMiA+Pj4gMTY7XHJcbiAgICBjMzIgJj0gMHhGRkZGO1xyXG4gICAgYzQ4ICs9IGE0OCArIGI0ODtcclxuICAgIGM0OCAmPSAweEZGRkY7XHJcbiAgICByZXR1cm4gZnJvbUJpdHMoKGMxNiA8PCAxNikgfCBjMDAsIChjNDggPDwgMTYpIHwgYzMyLCB0aGlzLnVuc2lnbmVkKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoZSBkaWZmZXJlbmNlIG9mIHRoaXMgYW5kIHRoZSBzcGVjaWZpZWQgTG9uZy5cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBzdWJ0cmFoZW5kIFN1YnRyYWhlbmRcclxuICogQHJldHVybnMgeyFMb25nfSBEaWZmZXJlbmNlXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnN1YnRyYWN0ID0gZnVuY3Rpb24gc3VidHJhY3Qoc3VidHJhaGVuZCkge1xyXG4gICAgaWYgKCFpc0xvbmcoc3VidHJhaGVuZCkpXHJcbiAgICAgICAgc3VidHJhaGVuZCA9IGZyb21WYWx1ZShzdWJ0cmFoZW5kKTtcclxuICAgIHJldHVybiB0aGlzLmFkZChzdWJ0cmFoZW5kLm5lZygpKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoZSBkaWZmZXJlbmNlIG9mIHRoaXMgYW5kIHRoZSBzcGVjaWZpZWQgTG9uZy4gVGhpcyBpcyBhbiBhbGlhcyBvZiB7QGxpbmsgTG9uZyNzdWJ0cmFjdH0uXHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd9IHN1YnRyYWhlbmQgU3VidHJhaGVuZFxyXG4gKiBAcmV0dXJucyB7IUxvbmd9IERpZmZlcmVuY2VcclxuICovXHJcbkxvbmdQcm90b3R5cGUuc3ViID0gTG9uZ1Byb3RvdHlwZS5zdWJ0cmFjdDtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoZSBwcm9kdWN0IG9mIHRoaXMgYW5kIHRoZSBzcGVjaWZpZWQgTG9uZy5cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBtdWx0aXBsaWVyIE11bHRpcGxpZXJcclxuICogQHJldHVybnMgeyFMb25nfSBQcm9kdWN0XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLm11bHRpcGx5ID0gZnVuY3Rpb24gbXVsdGlwbHkobXVsdGlwbGllcikge1xyXG4gICAgaWYgKHRoaXMuaXNaZXJvKCkpXHJcbiAgICAgICAgcmV0dXJuIFpFUk87XHJcbiAgICBpZiAoIWlzTG9uZyhtdWx0aXBsaWVyKSlcclxuICAgICAgICBtdWx0aXBsaWVyID0gZnJvbVZhbHVlKG11bHRpcGxpZXIpO1xyXG5cclxuICAgIC8vIHVzZSB3YXNtIHN1cHBvcnQgaWYgcHJlc2VudFxyXG4gICAgaWYgKHdhc20pIHtcclxuICAgICAgICB2YXIgbG93ID0gd2FzbS5tdWwodGhpcy5sb3csXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaGlnaCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgbXVsdGlwbGllci5sb3csXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIG11bHRpcGxpZXIuaGlnaCk7XHJcbiAgICAgICAgcmV0dXJuIGZyb21CaXRzKGxvdywgd2FzbS5nZXRfaGlnaCgpLCB0aGlzLnVuc2lnbmVkKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobXVsdGlwbGllci5pc1plcm8oKSlcclxuICAgICAgICByZXR1cm4gWkVSTztcclxuICAgIGlmICh0aGlzLmVxKE1JTl9WQUxVRSkpXHJcbiAgICAgICAgcmV0dXJuIG11bHRpcGxpZXIuaXNPZGQoKSA/IE1JTl9WQUxVRSA6IFpFUk87XHJcbiAgICBpZiAobXVsdGlwbGllci5lcShNSU5fVkFMVUUpKVxyXG4gICAgICAgIHJldHVybiB0aGlzLmlzT2RkKCkgPyBNSU5fVkFMVUUgOiBaRVJPO1xyXG5cclxuICAgIGlmICh0aGlzLmlzTmVnYXRpdmUoKSkge1xyXG4gICAgICAgIGlmIChtdWx0aXBsaWVyLmlzTmVnYXRpdmUoKSlcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMubmVnKCkubXVsKG11bHRpcGxpZXIubmVnKCkpO1xyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMubmVnKCkubXVsKG11bHRpcGxpZXIpLm5lZygpO1xyXG4gICAgfSBlbHNlIGlmIChtdWx0aXBsaWVyLmlzTmVnYXRpdmUoKSlcclxuICAgICAgICByZXR1cm4gdGhpcy5tdWwobXVsdGlwbGllci5uZWcoKSkubmVnKCk7XHJcblxyXG4gICAgLy8gSWYgYm90aCBsb25ncyBhcmUgc21hbGwsIHVzZSBmbG9hdCBtdWx0aXBsaWNhdGlvblxyXG4gICAgaWYgKHRoaXMubHQoVFdPX1BXUl8yNCkgJiYgbXVsdGlwbGllci5sdChUV09fUFdSXzI0KSlcclxuICAgICAgICByZXR1cm4gZnJvbU51bWJlcih0aGlzLnRvTnVtYmVyKCkgKiBtdWx0aXBsaWVyLnRvTnVtYmVyKCksIHRoaXMudW5zaWduZWQpO1xyXG5cclxuICAgIC8vIERpdmlkZSBlYWNoIGxvbmcgaW50byA0IGNodW5rcyBvZiAxNiBiaXRzLCBhbmQgdGhlbiBhZGQgdXAgNHg0IHByb2R1Y3RzLlxyXG4gICAgLy8gV2UgY2FuIHNraXAgcHJvZHVjdHMgdGhhdCB3b3VsZCBvdmVyZmxvdy5cclxuXHJcbiAgICB2YXIgYTQ4ID0gdGhpcy5oaWdoID4+PiAxNjtcclxuICAgIHZhciBhMzIgPSB0aGlzLmhpZ2ggJiAweEZGRkY7XHJcbiAgICB2YXIgYTE2ID0gdGhpcy5sb3cgPj4+IDE2O1xyXG4gICAgdmFyIGEwMCA9IHRoaXMubG93ICYgMHhGRkZGO1xyXG5cclxuICAgIHZhciBiNDggPSBtdWx0aXBsaWVyLmhpZ2ggPj4+IDE2O1xyXG4gICAgdmFyIGIzMiA9IG11bHRpcGxpZXIuaGlnaCAmIDB4RkZGRjtcclxuICAgIHZhciBiMTYgPSBtdWx0aXBsaWVyLmxvdyA+Pj4gMTY7XHJcbiAgICB2YXIgYjAwID0gbXVsdGlwbGllci5sb3cgJiAweEZGRkY7XHJcblxyXG4gICAgdmFyIGM0OCA9IDAsIGMzMiA9IDAsIGMxNiA9IDAsIGMwMCA9IDA7XHJcbiAgICBjMDAgKz0gYTAwICogYjAwO1xyXG4gICAgYzE2ICs9IGMwMCA+Pj4gMTY7XHJcbiAgICBjMDAgJj0gMHhGRkZGO1xyXG4gICAgYzE2ICs9IGExNiAqIGIwMDtcclxuICAgIGMzMiArPSBjMTYgPj4+IDE2O1xyXG4gICAgYzE2ICY9IDB4RkZGRjtcclxuICAgIGMxNiArPSBhMDAgKiBiMTY7XHJcbiAgICBjMzIgKz0gYzE2ID4+PiAxNjtcclxuICAgIGMxNiAmPSAweEZGRkY7XHJcbiAgICBjMzIgKz0gYTMyICogYjAwO1xyXG4gICAgYzQ4ICs9IGMzMiA+Pj4gMTY7XHJcbiAgICBjMzIgJj0gMHhGRkZGO1xyXG4gICAgYzMyICs9IGExNiAqIGIxNjtcclxuICAgIGM0OCArPSBjMzIgPj4+IDE2O1xyXG4gICAgYzMyICY9IDB4RkZGRjtcclxuICAgIGMzMiArPSBhMDAgKiBiMzI7XHJcbiAgICBjNDggKz0gYzMyID4+PiAxNjtcclxuICAgIGMzMiAmPSAweEZGRkY7XHJcbiAgICBjNDggKz0gYTQ4ICogYjAwICsgYTMyICogYjE2ICsgYTE2ICogYjMyICsgYTAwICogYjQ4O1xyXG4gICAgYzQ4ICY9IDB4RkZGRjtcclxuICAgIHJldHVybiBmcm9tQml0cygoYzE2IDw8IDE2KSB8IGMwMCwgKGM0OCA8PCAxNikgfCBjMzIsIHRoaXMudW5zaWduZWQpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhlIHByb2R1Y3Qgb2YgdGhpcyBhbmQgdGhlIHNwZWNpZmllZCBMb25nLiBUaGlzIGlzIGFuIGFsaWFzIG9mIHtAbGluayBMb25nI211bHRpcGx5fS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gbXVsdGlwbGllciBNdWx0aXBsaWVyXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gUHJvZHVjdFxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5tdWwgPSBMb25nUHJvdG90eXBlLm11bHRpcGx5O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhpcyBMb25nIGRpdmlkZWQgYnkgdGhlIHNwZWNpZmllZC4gVGhlIHJlc3VsdCBpcyBzaWduZWQgaWYgdGhpcyBMb25nIGlzIHNpZ25lZCBvclxyXG4gKiAgdW5zaWduZWQgaWYgdGhpcyBMb25nIGlzIHVuc2lnbmVkLlxyXG4gKiBAcGFyYW0geyFMb25nfG51bWJlcnxzdHJpbmd9IGRpdmlzb3IgRGl2aXNvclxyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFF1b3RpZW50XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmRpdmlkZSA9IGZ1bmN0aW9uIGRpdmlkZShkaXZpc29yKSB7XHJcbiAgICBpZiAoIWlzTG9uZyhkaXZpc29yKSlcclxuICAgICAgICBkaXZpc29yID0gZnJvbVZhbHVlKGRpdmlzb3IpO1xyXG4gICAgaWYgKGRpdmlzb3IuaXNaZXJvKCkpXHJcbiAgICAgICAgdGhyb3cgRXJyb3IoJ2RpdmlzaW9uIGJ5IHplcm8nKTtcclxuXHJcbiAgICAvLyB1c2Ugd2FzbSBzdXBwb3J0IGlmIHByZXNlbnRcclxuICAgIGlmICh3YXNtKSB7XHJcbiAgICAgICAgLy8gZ3VhcmQgYWdhaW5zdCBzaWduZWQgZGl2aXNpb24gb3ZlcmZsb3c6IHRoZSBsYXJnZXN0XHJcbiAgICAgICAgLy8gbmVnYXRpdmUgbnVtYmVyIC8gLTEgd291bGQgYmUgMSBsYXJnZXIgdGhhbiB0aGUgbGFyZ2VzdFxyXG4gICAgICAgIC8vIHBvc2l0aXZlIG51bWJlciwgZHVlIHRvIHR3bydzIGNvbXBsZW1lbnQuXHJcbiAgICAgICAgaWYgKCF0aGlzLnVuc2lnbmVkICYmXHJcbiAgICAgICAgICAgIHRoaXMuaGlnaCA9PT0gLTB4ODAwMDAwMDAgJiZcclxuICAgICAgICAgICAgZGl2aXNvci5sb3cgPT09IC0xICYmIGRpdmlzb3IuaGlnaCA9PT0gLTEpIHtcclxuICAgICAgICAgICAgLy8gYmUgY29uc2lzdGVudCB3aXRoIG5vbi13YXNtIGNvZGUgcGF0aFxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcztcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIGxvdyA9ICh0aGlzLnVuc2lnbmVkID8gd2FzbS5kaXZfdSA6IHdhc20uZGl2X3MpKFxyXG4gICAgICAgICAgICB0aGlzLmxvdyxcclxuICAgICAgICAgICAgdGhpcy5oaWdoLFxyXG4gICAgICAgICAgICBkaXZpc29yLmxvdyxcclxuICAgICAgICAgICAgZGl2aXNvci5oaWdoXHJcbiAgICAgICAgKTtcclxuICAgICAgICByZXR1cm4gZnJvbUJpdHMobG93LCB3YXNtLmdldF9oaWdoKCksIHRoaXMudW5zaWduZWQpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLmlzWmVybygpKVxyXG4gICAgICAgIHJldHVybiB0aGlzLnVuc2lnbmVkID8gVVpFUk8gOiBaRVJPO1xyXG4gICAgdmFyIGFwcHJveCwgcmVtLCByZXM7XHJcbiAgICBpZiAoIXRoaXMudW5zaWduZWQpIHtcclxuICAgICAgICAvLyBUaGlzIHNlY3Rpb24gaXMgb25seSByZWxldmFudCBmb3Igc2lnbmVkIGxvbmdzIGFuZCBpcyBkZXJpdmVkIGZyb20gdGhlXHJcbiAgICAgICAgLy8gY2xvc3VyZSBsaWJyYXJ5IGFzIGEgd2hvbGUuXHJcbiAgICAgICAgaWYgKHRoaXMuZXEoTUlOX1ZBTFVFKSkge1xyXG4gICAgICAgICAgICBpZiAoZGl2aXNvci5lcShPTkUpIHx8IGRpdmlzb3IuZXEoTkVHX09ORSkpXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gTUlOX1ZBTFVFOyAgLy8gcmVjYWxsIHRoYXQgLU1JTl9WQUxVRSA9PSBNSU5fVkFMVUVcclxuICAgICAgICAgICAgZWxzZSBpZiAoZGl2aXNvci5lcShNSU5fVkFMVUUpKVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIE9ORTtcclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBdCB0aGlzIHBvaW50LCB3ZSBoYXZlIHxvdGhlcnwgPj0gMiwgc28gfHRoaXMvb3RoZXJ8IDwgfE1JTl9WQUxVRXwuXHJcbiAgICAgICAgICAgICAgICB2YXIgaGFsZlRoaXMgPSB0aGlzLnNocigxKTtcclxuICAgICAgICAgICAgICAgIGFwcHJveCA9IGhhbGZUaGlzLmRpdihkaXZpc29yKS5zaGwoMSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoYXBwcm94LmVxKFpFUk8pKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpdmlzb3IuaXNOZWdhdGl2ZSgpID8gT05FIDogTkVHX09ORTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVtID0gdGhpcy5zdWIoZGl2aXNvci5tdWwoYXBwcm94KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzID0gYXBwcm94LmFkZChyZW0uZGl2KGRpdmlzb3IpKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChkaXZpc29yLmVxKE1JTl9WQUxVRSkpXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVuc2lnbmVkID8gVVpFUk8gOiBaRVJPO1xyXG4gICAgICAgIGlmICh0aGlzLmlzTmVnYXRpdmUoKSkge1xyXG4gICAgICAgICAgICBpZiAoZGl2aXNvci5pc05lZ2F0aXZlKCkpXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5uZWcoKS5kaXYoZGl2aXNvci5uZWcoKSk7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm5lZygpLmRpdihkaXZpc29yKS5uZWcoKTtcclxuICAgICAgICB9IGVsc2UgaWYgKGRpdmlzb3IuaXNOZWdhdGl2ZSgpKVxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kaXYoZGl2aXNvci5uZWcoKSkubmVnKCk7XHJcbiAgICAgICAgcmVzID0gWkVSTztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gVGhlIGFsZ29yaXRobSBiZWxvdyBoYXMgbm90IGJlZW4gbWFkZSBmb3IgdW5zaWduZWQgbG9uZ3MuIEl0J3MgdGhlcmVmb3JlXHJcbiAgICAgICAgLy8gcmVxdWlyZWQgdG8gdGFrZSBzcGVjaWFsIGNhcmUgb2YgdGhlIE1TQiBwcmlvciB0byBydW5uaW5nIGl0LlxyXG4gICAgICAgIGlmICghZGl2aXNvci51bnNpZ25lZClcclxuICAgICAgICAgICAgZGl2aXNvciA9IGRpdmlzb3IudG9VbnNpZ25lZCgpO1xyXG4gICAgICAgIGlmIChkaXZpc29yLmd0KHRoaXMpKVxyXG4gICAgICAgICAgICByZXR1cm4gVVpFUk87XHJcbiAgICAgICAgaWYgKGRpdmlzb3IuZ3QodGhpcy5zaHJ1KDEpKSkgLy8gMTUgPj4+IDEgPSA3IDsgd2l0aCBkaXZpc29yID0gOCA7IHRydWVcclxuICAgICAgICAgICAgcmV0dXJuIFVPTkU7XHJcbiAgICAgICAgcmVzID0gVVpFUk87XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVwZWF0IHRoZSBmb2xsb3dpbmcgdW50aWwgdGhlIHJlbWFpbmRlciBpcyBsZXNzIHRoYW4gb3RoZXI6ICBmaW5kIGFcclxuICAgIC8vIGZsb2F0aW5nLXBvaW50IHRoYXQgYXBwcm94aW1hdGVzIHJlbWFpbmRlciAvIG90aGVyICpmcm9tIGJlbG93KiwgYWRkIHRoaXNcclxuICAgIC8vIGludG8gdGhlIHJlc3VsdCwgYW5kIHN1YnRyYWN0IGl0IGZyb20gdGhlIHJlbWFpbmRlci4gIEl0IGlzIGNyaXRpY2FsIHRoYXRcclxuICAgIC8vIHRoZSBhcHByb3hpbWF0ZSB2YWx1ZSBpcyBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gdGhlIHJlYWwgdmFsdWUgc28gdGhhdCB0aGVcclxuICAgIC8vIHJlbWFpbmRlciBuZXZlciBiZWNvbWVzIG5lZ2F0aXZlLlxyXG4gICAgcmVtID0gdGhpcztcclxuICAgIHdoaWxlIChyZW0uZ3RlKGRpdmlzb3IpKSB7XHJcbiAgICAgICAgLy8gQXBwcm94aW1hdGUgdGhlIHJlc3VsdCBvZiBkaXZpc2lvbi4gVGhpcyBtYXkgYmUgYSBsaXR0bGUgZ3JlYXRlciBvclxyXG4gICAgICAgIC8vIHNtYWxsZXIgdGhhbiB0aGUgYWN0dWFsIHZhbHVlLlxyXG4gICAgICAgIGFwcHJveCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocmVtLnRvTnVtYmVyKCkgLyBkaXZpc29yLnRvTnVtYmVyKCkpKTtcclxuXHJcbiAgICAgICAgLy8gV2Ugd2lsbCB0d2VhayB0aGUgYXBwcm94aW1hdGUgcmVzdWx0IGJ5IGNoYW5naW5nIGl0IGluIHRoZSA0OC10aCBkaWdpdCBvclxyXG4gICAgICAgIC8vIHRoZSBzbWFsbGVzdCBub24tZnJhY3Rpb25hbCBkaWdpdCwgd2hpY2hldmVyIGlzIGxhcmdlci5cclxuICAgICAgICB2YXIgbG9nMiA9IE1hdGguY2VpbChNYXRoLmxvZyhhcHByb3gpIC8gTWF0aC5MTjIpLFxyXG4gICAgICAgICAgICBkZWx0YSA9IChsb2cyIDw9IDQ4KSA/IDEgOiBwb3dfZGJsKDIsIGxvZzIgLSA0OCksXHJcblxyXG4gICAgICAgIC8vIERlY3JlYXNlIHRoZSBhcHByb3hpbWF0aW9uIHVudGlsIGl0IGlzIHNtYWxsZXIgdGhhbiB0aGUgcmVtYWluZGVyLiAgTm90ZVxyXG4gICAgICAgIC8vIHRoYXQgaWYgaXQgaXMgdG9vIGxhcmdlLCB0aGUgcHJvZHVjdCBvdmVyZmxvd3MgYW5kIGlzIG5lZ2F0aXZlLlxyXG4gICAgICAgICAgICBhcHByb3hSZXMgPSBmcm9tTnVtYmVyKGFwcHJveCksXHJcbiAgICAgICAgICAgIGFwcHJveFJlbSA9IGFwcHJveFJlcy5tdWwoZGl2aXNvcik7XHJcbiAgICAgICAgd2hpbGUgKGFwcHJveFJlbS5pc05lZ2F0aXZlKCkgfHwgYXBwcm94UmVtLmd0KHJlbSkpIHtcclxuICAgICAgICAgICAgYXBwcm94IC09IGRlbHRhO1xyXG4gICAgICAgICAgICBhcHByb3hSZXMgPSBmcm9tTnVtYmVyKGFwcHJveCwgdGhpcy51bnNpZ25lZCk7XHJcbiAgICAgICAgICAgIGFwcHJveFJlbSA9IGFwcHJveFJlcy5tdWwoZGl2aXNvcik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBXZSBrbm93IHRoZSBhbnN3ZXIgY2FuJ3QgYmUgemVyby4uLiBhbmQgYWN0dWFsbHksIHplcm8gd291bGQgY2F1c2VcclxuICAgICAgICAvLyBpbmZpbml0ZSByZWN1cnNpb24gc2luY2Ugd2Ugd291bGQgbWFrZSBubyBwcm9ncmVzcy5cclxuICAgICAgICBpZiAoYXBwcm94UmVzLmlzWmVybygpKVxyXG4gICAgICAgICAgICBhcHByb3hSZXMgPSBPTkU7XHJcblxyXG4gICAgICAgIHJlcyA9IHJlcy5hZGQoYXBwcm94UmVzKTtcclxuICAgICAgICByZW0gPSByZW0uc3ViKGFwcHJveFJlbSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhpcyBMb25nIGRpdmlkZWQgYnkgdGhlIHNwZWNpZmllZC4gVGhpcyBpcyBhbiBhbGlhcyBvZiB7QGxpbmsgTG9uZyNkaXZpZGV9LlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBkaXZpc29yIERpdmlzb3JcclxuICogQHJldHVybnMgeyFMb25nfSBRdW90aWVudFxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5kaXYgPSBMb25nUHJvdG90eXBlLmRpdmlkZTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoaXMgTG9uZyBtb2R1bG8gdGhlIHNwZWNpZmllZC5cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBkaXZpc29yIERpdmlzb3JcclxuICogQHJldHVybnMgeyFMb25nfSBSZW1haW5kZXJcclxuICovXHJcbkxvbmdQcm90b3R5cGUubW9kdWxvID0gZnVuY3Rpb24gbW9kdWxvKGRpdmlzb3IpIHtcclxuICAgIGlmICghaXNMb25nKGRpdmlzb3IpKVxyXG4gICAgICAgIGRpdmlzb3IgPSBmcm9tVmFsdWUoZGl2aXNvcik7XHJcblxyXG4gICAgLy8gdXNlIHdhc20gc3VwcG9ydCBpZiBwcmVzZW50XHJcbiAgICBpZiAod2FzbSkge1xyXG4gICAgICAgIHZhciBsb3cgPSAodGhpcy51bnNpZ25lZCA/IHdhc20ucmVtX3UgOiB3YXNtLnJlbV9zKShcclxuICAgICAgICAgICAgdGhpcy5sb3csXHJcbiAgICAgICAgICAgIHRoaXMuaGlnaCxcclxuICAgICAgICAgICAgZGl2aXNvci5sb3csXHJcbiAgICAgICAgICAgIGRpdmlzb3IuaGlnaFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgcmV0dXJuIGZyb21CaXRzKGxvdywgd2FzbS5nZXRfaGlnaCgpLCB0aGlzLnVuc2lnbmVkKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcy5zdWIodGhpcy5kaXYoZGl2aXNvcikubXVsKGRpdmlzb3IpKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoaXMgTG9uZyBtb2R1bG8gdGhlIHNwZWNpZmllZC4gVGhpcyBpcyBhbiBhbGlhcyBvZiB7QGxpbmsgTG9uZyNtb2R1bG99LlxyXG4gKiBAZnVuY3Rpb25cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBkaXZpc29yIERpdmlzb3JcclxuICogQHJldHVybnMgeyFMb25nfSBSZW1haW5kZXJcclxuICovXHJcbkxvbmdQcm90b3R5cGUubW9kID0gTG9uZ1Byb3RvdHlwZS5tb2R1bG87XHJcblxyXG4vKipcclxuICogUmV0dXJucyB0aGlzIExvbmcgbW9kdWxvIHRoZSBzcGVjaWZpZWQuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjbW9kdWxvfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gZGl2aXNvciBEaXZpc29yXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gUmVtYWluZGVyXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnJlbSA9IExvbmdQcm90b3R5cGUubW9kdWxvO1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhlIGJpdHdpc2UgTk9UIG9mIHRoaXMgTG9uZy5cclxuICogQHJldHVybnMgeyFMb25nfVxyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5ub3QgPSBmdW5jdGlvbiBub3QoKSB7XHJcbiAgICByZXR1cm4gZnJvbUJpdHMofnRoaXMubG93LCB+dGhpcy5oaWdoLCB0aGlzLnVuc2lnbmVkKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoZSBiaXR3aXNlIEFORCBvZiB0aGlzIExvbmcgYW5kIHRoZSBzcGVjaWZpZWQuXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgTG9uZ1xyXG4gKiBAcmV0dXJucyB7IUxvbmd9XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLmFuZCA9IGZ1bmN0aW9uIGFuZChvdGhlcikge1xyXG4gICAgaWYgKCFpc0xvbmcob3RoZXIpKVxyXG4gICAgICAgIG90aGVyID0gZnJvbVZhbHVlKG90aGVyKTtcclxuICAgIHJldHVybiBmcm9tQml0cyh0aGlzLmxvdyAmIG90aGVyLmxvdywgdGhpcy5oaWdoICYgb3RoZXIuaGlnaCwgdGhpcy51bnNpZ25lZCk7XHJcbn07XHJcblxyXG4vKipcclxuICogUmV0dXJucyB0aGUgYml0d2lzZSBPUiBvZiB0aGlzIExvbmcgYW5kIHRoZSBzcGVjaWZpZWQuXHJcbiAqIEBwYXJhbSB7IUxvbmd8bnVtYmVyfHN0cmluZ30gb3RoZXIgT3RoZXIgTG9uZ1xyXG4gKiBAcmV0dXJucyB7IUxvbmd9XHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLm9yID0gZnVuY3Rpb24gb3Iob3RoZXIpIHtcclxuICAgIGlmICghaXNMb25nKG90aGVyKSlcclxuICAgICAgICBvdGhlciA9IGZyb21WYWx1ZShvdGhlcik7XHJcbiAgICByZXR1cm4gZnJvbUJpdHModGhpcy5sb3cgfCBvdGhlci5sb3csIHRoaXMuaGlnaCB8IG90aGVyLmhpZ2gsIHRoaXMudW5zaWduZWQpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhlIGJpdHdpc2UgWE9SIG9mIHRoaXMgTG9uZyBhbmQgdGhlIGdpdmVuIG9uZS5cclxuICogQHBhcmFtIHshTG9uZ3xudW1iZXJ8c3RyaW5nfSBvdGhlciBPdGhlciBMb25nXHJcbiAqIEByZXR1cm5zIHshTG9uZ31cclxuICovXHJcbkxvbmdQcm90b3R5cGUueG9yID0gZnVuY3Rpb24geG9yKG90aGVyKSB7XHJcbiAgICBpZiAoIWlzTG9uZyhvdGhlcikpXHJcbiAgICAgICAgb3RoZXIgPSBmcm9tVmFsdWUob3RoZXIpO1xyXG4gICAgcmV0dXJuIGZyb21CaXRzKHRoaXMubG93IF4gb3RoZXIubG93LCB0aGlzLmhpZ2ggXiBvdGhlci5oaWdoLCB0aGlzLnVuc2lnbmVkKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoaXMgTG9uZyB3aXRoIGJpdHMgc2hpZnRlZCB0byB0aGUgbGVmdCBieSB0aGUgZ2l2ZW4gYW1vdW50LlxyXG4gKiBAcGFyYW0ge251bWJlcnwhTG9uZ30gbnVtQml0cyBOdW1iZXIgb2YgYml0c1xyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFNoaWZ0ZWQgTG9uZ1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5zaGlmdExlZnQgPSBmdW5jdGlvbiBzaGlmdExlZnQobnVtQml0cykge1xyXG4gICAgaWYgKGlzTG9uZyhudW1CaXRzKSlcclxuICAgICAgICBudW1CaXRzID0gbnVtQml0cy50b0ludCgpO1xyXG4gICAgaWYgKChudW1CaXRzICY9IDYzKSA9PT0gMClcclxuICAgICAgICByZXR1cm4gdGhpcztcclxuICAgIGVsc2UgaWYgKG51bUJpdHMgPCAzMilcclxuICAgICAgICByZXR1cm4gZnJvbUJpdHModGhpcy5sb3cgPDwgbnVtQml0cywgKHRoaXMuaGlnaCA8PCBudW1CaXRzKSB8ICh0aGlzLmxvdyA+Pj4gKDMyIC0gbnVtQml0cykpLCB0aGlzLnVuc2lnbmVkKTtcclxuICAgIGVsc2VcclxuICAgICAgICByZXR1cm4gZnJvbUJpdHMoMCwgdGhpcy5sb3cgPDwgKG51bUJpdHMgLSAzMiksIHRoaXMudW5zaWduZWQpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhpcyBMb25nIHdpdGggYml0cyBzaGlmdGVkIHRvIHRoZSBsZWZ0IGJ5IHRoZSBnaXZlbiBhbW91bnQuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjc2hpZnRMZWZ0fS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7bnVtYmVyfCFMb25nfSBudW1CaXRzIE51bWJlciBvZiBiaXRzXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gU2hpZnRlZCBMb25nXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnNobCA9IExvbmdQcm90b3R5cGUuc2hpZnRMZWZ0O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgdGhpcyBMb25nIHdpdGggYml0cyBhcml0aG1ldGljYWxseSBzaGlmdGVkIHRvIHRoZSByaWdodCBieSB0aGUgZ2l2ZW4gYW1vdW50LlxyXG4gKiBAcGFyYW0ge251bWJlcnwhTG9uZ30gbnVtQml0cyBOdW1iZXIgb2YgYml0c1xyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFNoaWZ0ZWQgTG9uZ1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5zaGlmdFJpZ2h0ID0gZnVuY3Rpb24gc2hpZnRSaWdodChudW1CaXRzKSB7XHJcbiAgICBpZiAoaXNMb25nKG51bUJpdHMpKVxyXG4gICAgICAgIG51bUJpdHMgPSBudW1CaXRzLnRvSW50KCk7XHJcbiAgICBpZiAoKG51bUJpdHMgJj0gNjMpID09PSAwKVxyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgZWxzZSBpZiAobnVtQml0cyA8IDMyKVxyXG4gICAgICAgIHJldHVybiBmcm9tQml0cygodGhpcy5sb3cgPj4+IG51bUJpdHMpIHwgKHRoaXMuaGlnaCA8PCAoMzIgLSBudW1CaXRzKSksIHRoaXMuaGlnaCA+PiBudW1CaXRzLCB0aGlzLnVuc2lnbmVkKTtcclxuICAgIGVsc2VcclxuICAgICAgICByZXR1cm4gZnJvbUJpdHModGhpcy5oaWdoID4+IChudW1CaXRzIC0gMzIpLCB0aGlzLmhpZ2ggPj0gMCA/IDAgOiAtMSwgdGhpcy51bnNpZ25lZCk7XHJcbn07XHJcblxyXG4vKipcclxuICogUmV0dXJucyB0aGlzIExvbmcgd2l0aCBiaXRzIGFyaXRobWV0aWNhbGx5IHNoaWZ0ZWQgdG8gdGhlIHJpZ2h0IGJ5IHRoZSBnaXZlbiBhbW91bnQuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjc2hpZnRSaWdodH0uXHJcbiAqIEBmdW5jdGlvblxyXG4gKiBAcGFyYW0ge251bWJlcnwhTG9uZ30gbnVtQml0cyBOdW1iZXIgb2YgYml0c1xyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFNoaWZ0ZWQgTG9uZ1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5zaHIgPSBMb25nUHJvdG90eXBlLnNoaWZ0UmlnaHQ7XHJcblxyXG4vKipcclxuICogUmV0dXJucyB0aGlzIExvbmcgd2l0aCBiaXRzIGxvZ2ljYWxseSBzaGlmdGVkIHRvIHRoZSByaWdodCBieSB0aGUgZ2l2ZW4gYW1vdW50LlxyXG4gKiBAcGFyYW0ge251bWJlcnwhTG9uZ30gbnVtQml0cyBOdW1iZXIgb2YgYml0c1xyXG4gKiBAcmV0dXJucyB7IUxvbmd9IFNoaWZ0ZWQgTG9uZ1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS5zaGlmdFJpZ2h0VW5zaWduZWQgPSBmdW5jdGlvbiBzaGlmdFJpZ2h0VW5zaWduZWQobnVtQml0cykge1xyXG4gICAgaWYgKGlzTG9uZyhudW1CaXRzKSlcclxuICAgICAgICBudW1CaXRzID0gbnVtQml0cy50b0ludCgpO1xyXG4gICAgbnVtQml0cyAmPSA2MztcclxuICAgIGlmIChudW1CaXRzID09PSAwKVxyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgdmFyIGhpZ2ggPSB0aGlzLmhpZ2g7XHJcbiAgICAgICAgaWYgKG51bUJpdHMgPCAzMikge1xyXG4gICAgICAgICAgICB2YXIgbG93ID0gdGhpcy5sb3c7XHJcbiAgICAgICAgICAgIHJldHVybiBmcm9tQml0cygobG93ID4+PiBudW1CaXRzKSB8IChoaWdoIDw8ICgzMiAtIG51bUJpdHMpKSwgaGlnaCA+Pj4gbnVtQml0cywgdGhpcy51bnNpZ25lZCk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChudW1CaXRzID09PSAzMilcclxuICAgICAgICAgICAgcmV0dXJuIGZyb21CaXRzKGhpZ2gsIDAsIHRoaXMudW5zaWduZWQpO1xyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgICAgcmV0dXJuIGZyb21CaXRzKGhpZ2ggPj4+IChudW1CaXRzIC0gMzIpLCAwLCB0aGlzLnVuc2lnbmVkKTtcclxuICAgIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoaXMgTG9uZyB3aXRoIGJpdHMgbG9naWNhbGx5IHNoaWZ0ZWQgdG8gdGhlIHJpZ2h0IGJ5IHRoZSBnaXZlbiBhbW91bnQuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjc2hpZnRSaWdodFVuc2lnbmVkfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7bnVtYmVyfCFMb25nfSBudW1CaXRzIE51bWJlciBvZiBiaXRzXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gU2hpZnRlZCBMb25nXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnNocnUgPSBMb25nUHJvdG90eXBlLnNoaWZ0UmlnaHRVbnNpZ25lZDtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIHRoaXMgTG9uZyB3aXRoIGJpdHMgbG9naWNhbGx5IHNoaWZ0ZWQgdG8gdGhlIHJpZ2h0IGJ5IHRoZSBnaXZlbiBhbW91bnQuIFRoaXMgaXMgYW4gYWxpYXMgb2Yge0BsaW5rIExvbmcjc2hpZnRSaWdodFVuc2lnbmVkfS5cclxuICogQGZ1bmN0aW9uXHJcbiAqIEBwYXJhbSB7bnVtYmVyfCFMb25nfSBudW1CaXRzIE51bWJlciBvZiBiaXRzXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gU2hpZnRlZCBMb25nXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnNocl91ID0gTG9uZ1Byb3RvdHlwZS5zaGlmdFJpZ2h0VW5zaWduZWQ7XHJcblxyXG4vKipcclxuICogQ29udmVydHMgdGhpcyBMb25nIHRvIHNpZ25lZC5cclxuICogQHJldHVybnMgeyFMb25nfSBTaWduZWQgbG9uZ1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS50b1NpZ25lZCA9IGZ1bmN0aW9uIHRvU2lnbmVkKCkge1xyXG4gICAgaWYgKCF0aGlzLnVuc2lnbmVkKVxyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgcmV0dXJuIGZyb21CaXRzKHRoaXMubG93LCB0aGlzLmhpZ2gsIGZhbHNlKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDb252ZXJ0cyB0aGlzIExvbmcgdG8gdW5zaWduZWQuXHJcbiAqIEByZXR1cm5zIHshTG9uZ30gVW5zaWduZWQgbG9uZ1xyXG4gKi9cclxuTG9uZ1Byb3RvdHlwZS50b1Vuc2lnbmVkID0gZnVuY3Rpb24gdG9VbnNpZ25lZCgpIHtcclxuICAgIGlmICh0aGlzLnVuc2lnbmVkKVxyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgcmV0dXJuIGZyb21CaXRzKHRoaXMubG93LCB0aGlzLmhpZ2gsIHRydWUpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIENvbnZlcnRzIHRoaXMgTG9uZyB0byBpdHMgYnl0ZSByZXByZXNlbnRhdGlvbi5cclxuICogQHBhcmFtIHtib29sZWFuPX0gbGUgV2hldGhlciBsaXR0bGUgb3IgYmlnIGVuZGlhbiwgZGVmYXVsdHMgdG8gYmlnIGVuZGlhblxyXG4gKiBAcmV0dXJucyB7IUFycmF5LjxudW1iZXI+fSBCeXRlIHJlcHJlc2VudGF0aW9uXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnRvQnl0ZXMgPSBmdW5jdGlvbiB0b0J5dGVzKGxlKSB7XHJcbiAgICByZXR1cm4gbGUgPyB0aGlzLnRvQnl0ZXNMRSgpIDogdGhpcy50b0J5dGVzQkUoKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDb252ZXJ0cyB0aGlzIExvbmcgdG8gaXRzIGxpdHRsZSBlbmRpYW4gYnl0ZSByZXByZXNlbnRhdGlvbi5cclxuICogQHJldHVybnMgeyFBcnJheS48bnVtYmVyPn0gTGl0dGxlIGVuZGlhbiBieXRlIHJlcHJlc2VudGF0aW9uXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnRvQnl0ZXNMRSA9IGZ1bmN0aW9uIHRvQnl0ZXNMRSgpIHtcclxuICAgIHZhciBoaSA9IHRoaXMuaGlnaCxcclxuICAgICAgICBsbyA9IHRoaXMubG93O1xyXG4gICAgcmV0dXJuIFtcclxuICAgICAgICBsbyAgICAgICAgJiAweGZmLFxyXG4gICAgICAgIGxvID4+PiAgOCAmIDB4ZmYsXHJcbiAgICAgICAgbG8gPj4+IDE2ICYgMHhmZixcclxuICAgICAgICBsbyA+Pj4gMjQgICAgICAgLFxyXG4gICAgICAgIGhpICAgICAgICAmIDB4ZmYsXHJcbiAgICAgICAgaGkgPj4+ICA4ICYgMHhmZixcclxuICAgICAgICBoaSA+Pj4gMTYgJiAweGZmLFxyXG4gICAgICAgIGhpID4+PiAyNFxyXG4gICAgXTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDb252ZXJ0cyB0aGlzIExvbmcgdG8gaXRzIGJpZyBlbmRpYW4gYnl0ZSByZXByZXNlbnRhdGlvbi5cclxuICogQHJldHVybnMgeyFBcnJheS48bnVtYmVyPn0gQmlnIGVuZGlhbiBieXRlIHJlcHJlc2VudGF0aW9uXHJcbiAqL1xyXG5Mb25nUHJvdG90eXBlLnRvQnl0ZXNCRSA9IGZ1bmN0aW9uIHRvQnl0ZXNCRSgpIHtcclxuICAgIHZhciBoaSA9IHRoaXMuaGlnaCxcclxuICAgICAgICBsbyA9IHRoaXMubG93O1xyXG4gICAgcmV0dXJuIFtcclxuICAgICAgICBoaSA+Pj4gMjQgICAgICAgLFxyXG4gICAgICAgIGhpID4+PiAxNiAmIDB4ZmYsXHJcbiAgICAgICAgaGkgPj4+ICA4ICYgMHhmZixcclxuICAgICAgICBoaSAgICAgICAgJiAweGZmLFxyXG4gICAgICAgIGxvID4+PiAyNCAgICAgICAsXHJcbiAgICAgICAgbG8gPj4+IDE2ICYgMHhmZixcclxuICAgICAgICBsbyA+Pj4gIDggJiAweGZmLFxyXG4gICAgICAgIGxvICAgICAgICAmIDB4ZmZcclxuICAgIF07XHJcbn07XHJcblxyXG4vKipcclxuICogQ3JlYXRlcyBhIExvbmcgZnJvbSBpdHMgYnl0ZSByZXByZXNlbnRhdGlvbi5cclxuICogQHBhcmFtIHshQXJyYXkuPG51bWJlcj59IGJ5dGVzIEJ5dGUgcmVwcmVzZW50YXRpb25cclxuICogQHBhcmFtIHtib29sZWFuPX0gdW5zaWduZWQgV2hldGhlciB1bnNpZ25lZCBvciBub3QsIGRlZmF1bHRzIHRvIHNpZ25lZFxyXG4gKiBAcGFyYW0ge2Jvb2xlYW49fSBsZSBXaGV0aGVyIGxpdHRsZSBvciBiaWcgZW5kaWFuLCBkZWZhdWx0cyB0byBiaWcgZW5kaWFuXHJcbiAqIEByZXR1cm5zIHtMb25nfSBUaGUgY29ycmVzcG9uZGluZyBMb25nIHZhbHVlXHJcbiAqL1xyXG5Mb25nLmZyb21CeXRlcyA9IGZ1bmN0aW9uIGZyb21CeXRlcyhieXRlcywgdW5zaWduZWQsIGxlKSB7XHJcbiAgICByZXR1cm4gbGUgPyBMb25nLmZyb21CeXRlc0xFKGJ5dGVzLCB1bnNpZ25lZCkgOiBMb25nLmZyb21CeXRlc0JFKGJ5dGVzLCB1bnNpZ25lZCk7XHJcbn07XHJcblxyXG4vKipcclxuICogQ3JlYXRlcyBhIExvbmcgZnJvbSBpdHMgbGl0dGxlIGVuZGlhbiBieXRlIHJlcHJlc2VudGF0aW9uLlxyXG4gKiBAcGFyYW0geyFBcnJheS48bnVtYmVyPn0gYnl0ZXMgTGl0dGxlIGVuZGlhbiBieXRlIHJlcHJlc2VudGF0aW9uXHJcbiAqIEBwYXJhbSB7Ym9vbGVhbj19IHVuc2lnbmVkIFdoZXRoZXIgdW5zaWduZWQgb3Igbm90LCBkZWZhdWx0cyB0byBzaWduZWRcclxuICogQHJldHVybnMge0xvbmd9IFRoZSBjb3JyZXNwb25kaW5nIExvbmcgdmFsdWVcclxuICovXHJcbkxvbmcuZnJvbUJ5dGVzTEUgPSBmdW5jdGlvbiBmcm9tQnl0ZXNMRShieXRlcywgdW5zaWduZWQpIHtcclxuICAgIHJldHVybiBuZXcgTG9uZyhcclxuICAgICAgICBieXRlc1swXSAgICAgICB8XHJcbiAgICAgICAgYnl0ZXNbMV0gPDwgIDggfFxyXG4gICAgICAgIGJ5dGVzWzJdIDw8IDE2IHxcclxuICAgICAgICBieXRlc1szXSA8PCAyNCxcclxuICAgICAgICBieXRlc1s0XSAgICAgICB8XHJcbiAgICAgICAgYnl0ZXNbNV0gPDwgIDggfFxyXG4gICAgICAgIGJ5dGVzWzZdIDw8IDE2IHxcclxuICAgICAgICBieXRlc1s3XSA8PCAyNCxcclxuICAgICAgICB1bnNpZ25lZFxyXG4gICAgKTtcclxufTtcclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIGEgTG9uZyBmcm9tIGl0cyBiaWcgZW5kaWFuIGJ5dGUgcmVwcmVzZW50YXRpb24uXHJcbiAqIEBwYXJhbSB7IUFycmF5LjxudW1iZXI+fSBieXRlcyBCaWcgZW5kaWFuIGJ5dGUgcmVwcmVzZW50YXRpb25cclxuICogQHBhcmFtIHtib29sZWFuPX0gdW5zaWduZWQgV2hldGhlciB1bnNpZ25lZCBvciBub3QsIGRlZmF1bHRzIHRvIHNpZ25lZFxyXG4gKiBAcmV0dXJucyB7TG9uZ30gVGhlIGNvcnJlc3BvbmRpbmcgTG9uZyB2YWx1ZVxyXG4gKi9cclxuTG9uZy5mcm9tQnl0ZXNCRSA9IGZ1bmN0aW9uIGZyb21CeXRlc0JFKGJ5dGVzLCB1bnNpZ25lZCkge1xyXG4gICAgcmV0dXJuIG5ldyBMb25nKFxyXG4gICAgICAgIGJ5dGVzWzRdIDw8IDI0IHxcclxuICAgICAgICBieXRlc1s1XSA8PCAxNiB8XHJcbiAgICAgICAgYnl0ZXNbNl0gPDwgIDggfFxyXG4gICAgICAgIGJ5dGVzWzddLFxyXG4gICAgICAgIGJ5dGVzWzBdIDw8IDI0IHxcclxuICAgICAgICBieXRlc1sxXSA8PCAxNiB8XHJcbiAgICAgICAgYnl0ZXNbMl0gPDwgIDggfFxyXG4gICAgICAgIGJ5dGVzWzNdLFxyXG4gICAgICAgIHVuc2lnbmVkXHJcbiAgICApO1xyXG59O1xyXG4iXX0=
