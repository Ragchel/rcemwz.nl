var exports = window.exports || (window.exports = {});
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NRBFReader = exports.BinaryObject = exports.BinaryArrayType = exports.BinaryType = exports.PrimitiveType = exports.RecordType = void 0;
var RecordType;
(function (RecordType) {
    RecordType[RecordType["SerializedStreamHeader"] = 0] = "SerializedStreamHeader";
    RecordType[RecordType["ClassWithId"] = 1] = "ClassWithId";
    RecordType[RecordType["SystemClassWithMembers"] = 2] = "SystemClassWithMembers";
    RecordType[RecordType["ClassWithMembers"] = 3] = "ClassWithMembers";
    RecordType[RecordType["SystemClassWithMembersAndTypes"] = 4] = "SystemClassWithMembersAndTypes";
    RecordType[RecordType["ClassWithMembersAndTypes"] = 5] = "ClassWithMembersAndTypes";
    RecordType[RecordType["BinaryObjectString"] = 6] = "BinaryObjectString";
    RecordType[RecordType["BinaryArray"] = 7] = "BinaryArray";
    RecordType[RecordType["MemberPrimitiveTyped"] = 8] = "MemberPrimitiveTyped";
    RecordType[RecordType["MemberReference"] = 9] = "MemberReference";
    RecordType[RecordType["ObjectNull"] = 10] = "ObjectNull";
    RecordType[RecordType["MessageEnd"] = 11] = "MessageEnd";
    RecordType[RecordType["BinaryLibrary"] = 12] = "BinaryLibrary";
    RecordType[RecordType["ObjectNullMultiple256"] = 13] = "ObjectNullMultiple256";
    RecordType[RecordType["ObjectNullMultiple"] = 14] = "ObjectNullMultiple";
    RecordType[RecordType["ArraySinglePrimitive"] = 15] = "ArraySinglePrimitive";
    RecordType[RecordType["ArraySingleObject"] = 16] = "ArraySingleObject";
    RecordType[RecordType["ArraySingleString"] = 17] = "ArraySingleString";
    RecordType[RecordType["MethodCall"] = 21] = "MethodCall";
    RecordType[RecordType["MethodReturn"] = 22] = "MethodReturn";
})(RecordType || (exports.RecordType = RecordType = {}));
var PrimitiveType;
(function (PrimitiveType) {
    PrimitiveType[PrimitiveType["None"] = 0] = "None";
    PrimitiveType[PrimitiveType["Boolean"] = 1] = "Boolean";
    PrimitiveType[PrimitiveType["Byte"] = 2] = "Byte";
    PrimitiveType[PrimitiveType["Char"] = 3] = "Char";
    PrimitiveType[PrimitiveType["Decimal"] = 5] = "Decimal";
    PrimitiveType[PrimitiveType["Double"] = 6] = "Double";
    PrimitiveType[PrimitiveType["Int16"] = 7] = "Int16";
    PrimitiveType[PrimitiveType["Int32"] = 8] = "Int32";
    PrimitiveType[PrimitiveType["Int64"] = 9] = "Int64";
    PrimitiveType[PrimitiveType["SByte"] = 10] = "SByte";
    PrimitiveType[PrimitiveType["Single"] = 11] = "Single";
    PrimitiveType[PrimitiveType["TimeSpan"] = 12] = "TimeSpan";
    PrimitiveType[PrimitiveType["DateTime"] = 13] = "DateTime";
    PrimitiveType[PrimitiveType["UInt16"] = 14] = "UInt16";
    PrimitiveType[PrimitiveType["UInt32"] = 15] = "UInt32";
    PrimitiveType[PrimitiveType["UInt64"] = 16] = "UInt64";
    PrimitiveType[PrimitiveType["Null"] = 17] = "Null";
    PrimitiveType[PrimitiveType["String"] = 18] = "String";
})(PrimitiveType || (exports.PrimitiveType = PrimitiveType = {}));
var BinaryType;
(function (BinaryType) {
    BinaryType[BinaryType["Primitive"] = 0] = "Primitive";
    BinaryType[BinaryType["String"] = 1] = "String";
    BinaryType[BinaryType["Object"] = 2] = "Object";
    BinaryType[BinaryType["SystemClass"] = 3] = "SystemClass";
    BinaryType[BinaryType["Class"] = 4] = "Class";
    BinaryType[BinaryType["ObjectArray"] = 5] = "ObjectArray";
    BinaryType[BinaryType["StringArray"] = 6] = "StringArray";
    BinaryType[BinaryType["PrimitiveArray"] = 7] = "PrimitiveArray";
})(BinaryType || (exports.BinaryType = BinaryType = {}));
var BinaryArrayType;
(function (BinaryArrayType) {
    BinaryArrayType[BinaryArrayType["Single"] = 0] = "Single";
    BinaryArrayType[BinaryArrayType["Jagged"] = 1] = "Jagged";
    BinaryArrayType[BinaryArrayType["Rectangular"] = 2] = "Rectangular";
    BinaryArrayType[BinaryArrayType["SingleOffset"] = 3] = "SingleOffset";
    BinaryArrayType[BinaryArrayType["JaggedOffset"] = 4] = "JaggedOffset";
    BinaryArrayType[BinaryArrayType["RectangularOffset"] = 5] = "RectangularOffset";
})(BinaryArrayType || (exports.BinaryArrayType = BinaryArrayType = {}));
class BinaryReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.position = 0;
    }
    readByte() { return this.buffer[this.position++]; }
    readSByte() { return (this.buffer[this.position++] << 24) >> 24; }
    readBoolean() { return this.readByte() !== 0; }
    readInt16() {
        const val = (this.buffer[this.position]) | (this.buffer[this.position + 1] << 8);
        this.position += 2;
        return (val << 16) >> 16;
    }
    readUInt16() {
        const val = (this.buffer[this.position]) | (this.buffer[this.position + 1] << 8);
        this.position += 2;
        return val;
    }
    readInt32() {
        const val = (this.buffer[this.position]) | (this.buffer[this.position + 1] << 8) | (this.buffer[this.position + 2] << 16) | (this.buffer[this.position + 3] << 24);
        this.position += 4;
        return val;
    }
    readUInt32() {
        const val = (this.buffer[this.position]) | (this.buffer[this.position + 1] << 8) | (this.buffer[this.position + 2] << 16) | (this.buffer[this.position + 3] << 24);
        this.position += 4;
        return val >>> 0;
    }
    readInt64() {
        const lo = this.readUInt32();
        const hi = this.readUInt32();
        return BigInt(lo) + (BigInt(hi) << 32n);
    }
    readUInt64() {
        const lo = this.readUInt32();
        const hi = this.readUInt32();
        return BigInt(lo) + (BigInt(hi) << 32n);
    }
    readSingle() {
        const bytes = this.buffer.slice(this.position, this.position + 4);
        this.position += 4;
        const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
        return view.getFloat32(0, true);
    }
    readDouble() {
        const bytes = this.buffer.slice(this.position, this.position + 8);
        this.position += 8;
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
        return view.getFloat64(0, true);
    }
    readChar() {
        const code = this.readUInt16();
        return String.fromCharCode(code);
    }
    readString() {
        let length = 0, shift = 0, byteRead;
        do {
            byteRead = this.readByte();
            length |= (byteRead & 0x7F) << shift;
            shift += 7;
        } while ((byteRead & 0x80) !== 0);
        if (length === 0)
            return '';
        const bytes = this.buffer.slice(this.position, this.position + length);
        this.position += length;
        return new TextDecoder('utf-8').decode(bytes);
    }
    get offset() { return this.position; }
    get remaining() { return this.buffer.length - this.position; }
    get length() { return this.buffer.length; }
}
class BinaryObject {
    constructor() {
        this.m = new Map();
        this.typeName = '';
    }
    get entries() { return this.m.entries(); }
    addMember(n, v) { this.m.set(n, v); }
}
exports.BinaryObject = BinaryObject;
const readClassInfo = (r) => {
    const objectId = r.readInt32();
    const name = r.readString();
    const memberCount = r.readInt32();
    return { objectId, name, memberCount, memberNames: Array.from({ length: memberCount }, () => r.readString()) };
};
const readMemberTypeInfo = (count, r) => {
    const binaryType = Array.from({ length: count }, () => r.readByte());
    const additionalInfos = [];
    for (let i = 0; i < count; i++) {
        const bt = binaryType[i];
        if (bt === BinaryType.Primitive || bt === BinaryType.PrimitiveArray)
            additionalInfos[i] = r.readByte();
        else if (bt === BinaryType.SystemClass || bt === BinaryType.Class) {
            r.readString();
            if (bt === BinaryType.Class)
                r.readInt32();
        }
    }
    return { binaryType, additionalInfos };
};
const readArrayInfo = (r) => ({ objectId: r.readInt32(), length: r.readInt32() });
const readHeader = (r) => {
    const rootId = r.readInt32();
    r.readInt32();
    if (r.readInt32() !== 1 || r.readInt32() !== 0)
        throw new Error('Invalid NRBF stream');
    return rootId;
};
const readTimeSpan = (r) => Number(r.readInt64()) / 10000;
const readDateTime = (r) => new Date(Number(((r.readInt64() & 0x3fffffffffffffffn) - 621355968000000000n) / 10000n));
const readPrimitive = (type, r) => {
    const m = {
        [PrimitiveType.Boolean]: () => r.readBoolean(), [PrimitiveType.Byte]: () => r.readByte(), [PrimitiveType.Char]: () => r.readChar(),
        [PrimitiveType.Double]: () => r.readDouble(), [PrimitiveType.Int16]: () => r.readInt16(), [PrimitiveType.Int32]: () => r.readInt32(),
        [PrimitiveType.Int64]: () => r.readInt64(), [PrimitiveType.SByte]: () => r.readSByte(), [PrimitiveType.Single]: () => r.readSingle(),
        [PrimitiveType.UInt16]: () => r.readUInt16(), [PrimitiveType.UInt32]: () => r.readUInt32(), [PrimitiveType.UInt64]: () => r.readUInt64(),
        [PrimitiveType.Decimal]: () => parseFloat(r.readString()), [PrimitiveType.TimeSpan]: () => readTimeSpan(r), [PrimitiveType.DateTime]: () => readDateTime(r),
    };
    const fn = m[type];
    if (!fn)
        throw new Error('Invalid primitive type: ' + PrimitiveType[type]);
    return fn();
};
const readBinaryArrayRecord = (r) => {
    const objectId = r.readInt32();
    const binaryArrayType = r.readByte();
    const rank = r.readInt32();
    const lengths = Array.from({ length: rank }, () => r.readInt32());
    const lowerBounds = [BinaryArrayType.SingleOffset, BinaryArrayType.JaggedOffset, BinaryArrayType.RectangularOffset].includes(binaryArrayType)
        ? Array.from({ length: rank }, () => r.readInt32()) : undefined;
    const binaryType = r.readByte();
    let primitiveType = PrimitiveType.None;
    if (binaryType === BinaryType.Primitive || binaryType === BinaryType.PrimitiveArray) {
        primitiveType = r.readByte();
    }
    else if (binaryType === BinaryType.SystemClass || binaryType === BinaryType.Class) {
        r.readString();
        if (binaryType === BinaryType.Class)
            r.readInt32();
    }
    return { objectId, binaryArrayType, rank, lengths, lowerBounds, binaryType, primitiveType };
};
function binaryObjectFromTracked(value) {
    if (value instanceof BinaryObject)
        return value;
    if (value && typeof value === 'object' && 'value' in value) {
        const inner = value.value;
        if (inner instanceof BinaryObject)
            return inner;
    }
    return null;
}
class NRBFReader {
    constructor(buffer) {
        this.endOfStream = false;
        this.objectTracker = new Map();
        this.deferredItems = [];
        this.libraries = [];
        this.read = () => this.readWithRecordType().value;
        this.reader = new BinaryReader(buffer);
    }
    static readStream(buffer) {
        return new NRBFReader(buffer).parse();
    }
    static inspectStream(buffer) {
        return new NRBFReader(buffer).inspect();
    }
    parse() {
        if (this.reader.readByte() !== RecordType.SerializedStreamHeader)
            throw new Error('Invalid NRBF stream');
        const rootId = readHeader(this.reader);
        while (!this.endOfStream)
            this.read();
        this.completeDeferredItems();
        return this.dereferenceTrackedObject(rootId);
    }
    inspect() {
        this.parse();
        const typeHistogram = {};
        const memberNames = new Set();
        const trackedStrings = new Set();
        for (const tracked of this.objectTracker.values()) {
            if (typeof tracked === 'string')
                trackedStrings.add(tracked);
            const obj = binaryObjectFromTracked(tracked);
            if (!obj)
                continue;
            const typeName = obj.typeName || '(anonymous)';
            typeHistogram[typeName] = (typeHistogram[typeName] ?? 0) + 1;
            for (const [name, value] of obj.entries) {
                memberNames.add(name);
                if (typeof value === 'string')
                    trackedStrings.add(value);
            }
        }
        return {
            leftoverBytes: this.reader.remaining,
            bytesRead: this.reader.offset,
            streamLength: this.reader.length,
            libraries: [...this.libraries],
            trackedObjectCount: this.objectTracker.size,
            typeHistogram,
            memberNames: [...memberNames].sort(),
            trackedStrings: [...trackedStrings].sort(),
        };
    }
    readWithRecordType() {
        let currentObject = null;
        const recordType = this.reader.readByte();
        switch (recordType) {
            case RecordType.ClassWithId:
            case RecordType.SystemClassWithMembers:
            case RecordType.ClassWithMembers:
            case RecordType.SystemClassWithMembersAndTypes:
            case RecordType.ClassWithMembersAndTypes:
                currentObject = this.readClassRecord(recordType);
                break;
            case RecordType.BinaryObjectString:
                {
                    const id = this.reader.readInt32();
                    currentObject = this.reader.readString();
                    if (id !== 0)
                        this.objectTracker.set(id, currentObject);
                }
                break;
            case RecordType.BinaryArray:
                {
                    const br = readBinaryArrayRecord(this.reader);
                    currentObject = this.readBinaryArray(br);
                    if (br.objectId !== 0)
                        this.objectTracker.set(br.objectId, currentObject);
                }
                break;
            case RecordType.MemberPrimitiveTyped:
                currentObject = readPrimitive(this.reader.readByte(), this.reader);
                break;
            case RecordType.MemberReference:
                {
                    const id = this.reader.readInt32();
                    const ref = this.objectTracker.get(id);
                    currentObject = ref === undefined ? { id } :
                        (ref && typeof ref === 'object' && 'value' in ref ? ref.value : ref);
                }
                break;
            case RecordType.ObjectNull:
                return { value: null, recordType };
            case RecordType.MessageEnd:
                this.endOfStream = true;
                break;
            case RecordType.BinaryLibrary:
                this.reader.readInt32();
                this.libraries.push(this.reader.readString());
                break;
            case RecordType.ObjectNullMultiple256:
            case RecordType.ObjectNullMultiple:
                currentObject = { nullCount: recordType === RecordType.ObjectNullMultiple256 ? this.reader.readByte() : this.reader.readInt32() };
                break;
            case RecordType.ArraySinglePrimitive:
            case RecordType.ArraySingleObject:
            case RecordType.ArraySingleString:
                currentObject = this.readSingleArrayRecord(recordType);
                break;
            case RecordType.MethodCall:
            case RecordType.MethodReturn:
            case RecordType.SerializedStreamHeader:
            default:
                throw new Error('RecordType not supported: ' + RecordType[recordType]);
        }
        return { value: currentObject, recordType };
    }
    readMembers(o, mns, mti) {
        for (let i = 0; i < mns.length; i++) {
            if (mti.binaryType[i] === BinaryType.Primitive) {
                o.addMember(mns[i], readPrimitive(mti.additionalInfos[i], this.reader));
            }
            else {
                const mc = this.read();
                if (mc && typeof mc === 'object' && 'id' in mc) {
                    this.deferredItems.push({ owner: o, member: mns[i], id: mc.id });
                    o.addMember(mns[i], null);
                }
                else
                    o.addMember(mns[i], mc);
            }
        }
    }
    readUntypedMembers(o, cn, mns) {
        if (cn === 'System.Guid' && mns.length === 11) {
            o.addMember('_a', this.reader.readInt32());
            o.addMember('_b', this.reader.readInt16());
            o.addMember('_c', this.reader.readInt16());
            ['_d', '_e', '_f', '_g', '_h', '_i', '_j', '_k'].forEach(m => o.addMember(m, this.reader.readByte()));
            return;
        }
        if (mns.length === 1 && mns[0] === 'value__') {
            o.addMember(mns[0], this.reader.readInt32());
            return;
        }
        throw new Error('Unsupported untyped member: ' + cn);
    }
    readClassRecord(recordType) {
        let value = null;
        switch (recordType) {
            case RecordType.ClassWithId:
                {
                    const oid = this.reader.readInt32();
                    const ref = this.objectTracker.get(this.reader.readInt32());
                    const o = Object.assign(new BinaryObject(), { typeName: ref.value.typeName });
                    if (oid !== 0)
                        this.objectTracker.set(oid, o);
                    value = o;
                    if (ref.memberTypeInfo) {
                        this.readMembers(o, ref.classInfo.memberNames, ref.memberTypeInfo);
                    }
                    else {
                        this.readUntypedMembers(o, o.typeName, ref.classInfo.memberNames);
                    }
                }
                break;
            case RecordType.SystemClassWithMembers:
            case RecordType.ClassWithMembers:
                {
                    const ci = readClassInfo(this.reader);
                    if (recordType === RecordType.ClassWithMembers)
                        this.reader.readInt32();
                    const v = Object.assign(new BinaryObject(), { typeName: ci.name });
                    const res = { classInfo: ci, value: v };
                    if (ci.objectId !== 0)
                        this.objectTracker.set(ci.objectId, res);
                    value = v;
                    this.readUntypedMembers(v, ci.name, ci.memberNames);
                }
                break;
            case RecordType.SystemClassWithMembersAndTypes:
            case RecordType.ClassWithMembersAndTypes:
                {
                    const ci = readClassInfo(this.reader);
                    const mti = readMemberTypeInfo(ci.memberCount, this.reader);
                    if (recordType === RecordType.ClassWithMembersAndTypes)
                        this.reader.readInt32();
                    const v = Object.assign(new BinaryObject(), { typeName: ci.name });
                    const res = { classInfo: ci, memberTypeInfo: mti, value: v };
                    if (ci.objectId !== 0)
                        this.objectTracker.set(ci.objectId, res);
                    value = v;
                    this.readMembers(v, ci.memberNames, mti);
                }
                break;
            default:
                throw new Error('RecordType not supported: ' + RecordType[recordType]);
        }
        return value;
    }
    readSingleArrayRecord(recordType) {
        const info = readArrayInfo(this.reader);
        const value = recordType === RecordType.ArraySinglePrimitive
            ? this.readPrimitiveArray(info, this.reader.readByte())
            : recordType === RecordType.ArraySingleObject
                ? this.readObjectArray(info)
                : this.readStringArray(info);
        if (info.objectId !== 0)
            this.objectTracker.set(info.objectId, value);
        return value;
    }
    readPrimitiveArray(info, type) {
        return Array.from({ length: info.length }, () => readPrimitive(type, this.reader));
    }
    readStringArray(info) {
        const r = [];
        for (let i = 0; i < info.length; i++) {
            const v = this.read();
            if (typeof v === 'string')
                r[i] = v;
            else if (v && typeof v === 'object' && 'nullCount' in v)
                i += v.nullCount - 1;
        }
        return r;
    }
    readObjectArray(info) {
        const r = [];
        for (let i = 0; i < info.length; i++) {
            const rr = this.readWithRecordType();
            const v = rr.recordType === RecordType.BinaryLibrary ? this.read() : rr.value;
            if (v && typeof v === 'object' && 'nullCount' in v)
                i += v.nullCount - 1;
            else if (v && typeof v === 'object' && 'id' in v) {
                const idx = i;
                this.deferredItems.push({ id: v.id, deferredAction: res => { r[idx] = res; } });
            }
            else
                r[i] = v;
        }
        return r;
    }
    readBinaryArray(r) {
        const createArray = (d, l) => d.length === 1
            ? (() => { const a = []; const lb = l ? l[0] : 0; for (let i = 0; i < d[0]; i++)
                a[lb + i] = undefined; return a; })()
            : (() => { const a = []; const lb = l ? l[0] : 0; for (let i = 0; i < d[0]; i++)
                a[lb + i] = createArray(d.slice(1), l?.slice(1)); return a; })();
        const res = createArray(r.lengths, r.lowerBounds);
        const firstIdx = (d, l) => d.map((_, i) => l ? l[i] : 0);
        const nextIdx = (idx, d, l) => {
            for (let i = idx.length - 1; i >= 0; --i) {
                idx[i]++;
                if (idx[i] <= (l ? l[i] : 0) + d[i] - 1)
                    return idx;
                idx[i] = l ? l[i] : 0;
            }
            return null;
        };
        const setVal = (a, idx, v) => {
            let c = a;
            for (let i = 0; i < idx.length - 1; i++)
                c = c[idx[i]];
            c[idx[idx.length - 1]] = v;
        };
        if (r.primitiveType === PrimitiveType.None || r.binaryArrayType === BinaryArrayType.Jagged) {
            if (r.binaryType !== BinaryType.Primitive) {
                let cc = 0;
                let idx = firstIdx(r.lengths, r.lowerBounds);
                while (idx !== null) {
                    if (cc > 0) {
                        cc--;
                        idx = nextIdx(idx, r.lengths, r.lowerBounds);
                        continue;
                    }
                    const rr = this.readWithRecordType();
                    const v = rr.recordType === RecordType.BinaryLibrary ? this.read() : rr.value;
                    if (v && typeof v === 'object' && 'nullCount' in v)
                        cc = v.nullCount - 1;
                    else if (v && typeof v === 'object' && 'id' in v) {
                        const si = [...idx];
                        this.deferredItems.push({ id: v.id, deferredAction: rv => setVal(res, si, rv) });
                    }
                    else
                        setVal(res, idx, v);
                    idx = nextIdx(idx, r.lengths, r.lowerBounds);
                }
            }
            else
                throw new Error('Unsupported array structure');
        }
        else {
            let idx = firstIdx(r.lengths, r.lowerBounds);
            while (idx !== null) {
                setVal(res, idx, readPrimitive(r.primitiveType, this.reader));
                idx = nextIdx(idx, r.lengths, r.lowerBounds);
            }
        }
        return res;
    }
    completeDeferredItems() {
        for (const it of this.deferredItems) {
            const ref = this.dereferenceTrackedObject(it.id);
            if (it.deferredAction)
                it.deferredAction(ref);
            else if (it.owner && it.member)
                it.owner.addMember(it.member, ref);
        }
    }
    dereferenceTrackedObject(id) {
        const ref = this.objectTracker.get(id);
        return (ref && typeof ref === 'object' && 'value' in ref) ? ref.value : ref;
    }
}
exports.NRBFReader = NRBFReader;
window.NRBFReader = exports.NRBFReader;
