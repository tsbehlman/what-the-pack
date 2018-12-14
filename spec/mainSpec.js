const MessagePack = require( "../index" );

describe( "what-the-pack", () => {
	const wtp = new MessagePack( 1 << 30 );
  
	const exactMatchCases = [
		[ "fixstr", [
			"",
			"hello",
			"WALL·E – Typeset in the Future",
			"🇺🇸🇷🇺🇸🇦",
			"α",
			"亜",
			"\uD83D\uDC26"
		] ],
		[ "str 8", [
			"a".repeat( 32 ),
			"a".repeat( 255 )
		] ],
		[ "str 16", [
			"a".repeat( 256 ),
			"a".repeat( 65535 )
		] ],
		[ "str 32", [
			"a".repeat( 65536 )
		] ],
		[ "positive fixint", [
			0x00,
			0x44,
			0x7f
		] ],
		[ "negative fixint", [
			-0x01,
			-0x10,
			-0x20
		] ],
		[ "int 8", [
			-128,
			127
		] ],
		[ "int 16", [
			256,
			-32768
		] ],
		[ "int 32", [
			-65536,
			-2147483648
		] ],
		[ "int 64", [
			-4294967296,
			-( Math.pow( 2, 53 ) - 1 ),
			-( Math.pow( 2, 63 ) - 1024 )
		] ],
		[ "uint 8", [
			128,
			255
		] ],
		[ "uint 16", [
			256,
			65535
		] ],
		[ "uint 32", [
			65536,
			4294967295
		] ],
		[ "uint 64", [
			4294967296,
			Math.pow( 2, 53 ) - 1,
			Math.pow( 2, 63 ) + 1024
		] ],
		[ "float 32", [
			0.5,
			0.25,
			0.125,
			0.0625,
			0.03125,
			0.015625
		] ],
		[ "float 64", [
			1.1,
			1.000001,
			1.1234567890
		] ],
		[ "value", [
			true,
			false,
			undefined,
			+Infinity,
			-Infinity
		] ]
	];
  
	for( const [ type, values ] of exactMatchCases ) {
		for( const value of values ) {
			it( `encodes and decodes ${type} ${value}`, () => {
				expect( wtp.decode( wtp.encode( value ) ) ).toBe( value );
			} );
		}
	}
  
	const equalMatchCases = [
		[ "value", [ NaN ] ],
		[ "empty arrays", [
			[],
			[
				[],
				[]
			],
			[
				[
					[],
					[],
					[]
				]
			]
		] ],
		[ "flat array", [
			[ 1, 2, 3 ],
			[ 1, 2, 3, "a", "b", "c" ],
			[ 1.5, 1.1, 1.1234567890, "a", "b".repeat( 10000 ), "c".repeat( 70000 ) ],
			[ 1, 0x80, 0x100, 0x10000, 0x100000000 ], // positive numbers
			[ -1, -0x80, -0x100, -0x10000, -0x100000000 ], // negative numbers
			[ "a".repeat( 31 ), "b".repeat( 255 ), "c".repeat( 10000 ), "d".repeat( 70000 ), "e".repeat( 1 << 27 ) ] // strings
		] ],
		[ "nested arrays", [
			[
				[ 1, 2, 3 ],
				[ 1, 2, 3, "a", "b", "c" ],
				[ 1.5, 1.1, 1.1234567890, "a", "b".repeat( 10000 ), "c".repeat( 70000 ) ]
			],
			[
				[ true, false, undefined, NaN, +Infinity, -Infinity ],
				[ 1.5, 1.1, 1.1234567890, "a", "b".repeat( 10000 ), "c".repeat( 70000 ) ]
			],
			[
				[ 1, 2, 3 ],
				[
					[ true, false, undefined, NaN, +Infinity, -Infinity ],
					[ 1.5, 1.1, 1.1234567890, "a", "b".repeat( 10000 ), "c".repeat( 70000 ) ]
				],
				[
					[
						[ 1, 2, 3 ],
						[ 1, 2, 3, "a", "b", "c" ],
						[ 1.5, 1.1, 1.1234567890, "a", "b".repeat( 10000 ), "c".repeat( 70000 ) ]
					]
				]
			]
		] ],
		[ "bin 8 buffer", [
			Buffer.allocUnsafe( 1 ),
			Buffer.allocUnsafe( 0x100 - 1 )
		] ],
		[ "bin 16 buffer", [
			Buffer.allocUnsafe( 0x10000 - 1 )
		] ],
		[ "bin 32 buffer", [
			Buffer.allocUnsafe( 0x10000 * 10 )
		] ]
	];
  
	for( const [ type, values ] of equalMatchCases ) {
		for( const value of values ) {
			it( `encodes and decodes ${type} ${value}`, () => {
				expect( wtp.decode( wtp.encode( value ) ) ).toEqual( value );
			} );
		}
	}
  
	it( "arraybuffers as buffer", () => {
		[
			new ArrayBuffer( 1 ),
			new ArrayBuffer( 0x100 ),
			new ArrayBuffer( 0x10000 )
		].forEach( ( value ) =>  expect( wtp.decode( wtp.encode( value ) ) ).toEqual( Buffer.from( value ) ) );
	} );
	it( "typedarrays as buffer", () => {
		[
			new Uint8Array( 0x100 ),
			new Uint16Array( 0x100 ),
			new Uint32Array( 0x100 ),
			new Int8Array( 0x100 ),
			new Int16Array( 0x100 ),
			new Int32Array( 0x100 ),
			new Float32Array( 0x100 ),
			new Float64Array( 0x100 )
		].forEach( ( value ) =>  expect( wtp.decode( wtp.encode( value ) ) ).toEqual( Buffer.from( value.buffer ) ) );
	} );
} );

function objectTests( wtp ) {
	it( "tiny object", () => {
		const value = {
			foo: 1,
			bar: "abc"
		};
		expect( wtp.decode( wtp.encode( value ) ) ).toEqual( value );
	} );
  
	it( "small object", () => {
		const value = {
			foo: 1,
			bar: [ 1, 2, 3, 4, "abc", "def" ],
			foobar: {
				foo: true,
				bar: -2147483649,
				foobar: {
					foo: Buffer.from( [ 1, 2, 3, 4, 5 ] ),
					bar: 1.5,
					foobar: [ true, false, "abcdefghijkmonpqrstuvwxyz" ]
				}
			}
		};
		expect( wtp.decode( wtp.encode( value ) ) ).toEqual( value );
	} );
  
	const array = ( length ) => {
		const arr = new Array( length );
		for ( let i = 0; i < arr.length; i++ ) {
			arr[ i ] = i;
		}
		return arr;
	};
  
	it( "medium object", () => {
		const value = {
			unsigned: [ 1, 2, 3, 4, { b: { c: [ 128, 256, 65536, 4294967296 ] } } ],
			signed: [ -1, -2, -3, -4, { b: { c: [ -33, -129, -32769, -2147483649 ] } } ],
			str: [ "abc", "g".repeat( 32 ), "h".repeat( 256 ) ],
			array: [ [], array( 16 ) ],
			map: {},
			nil: null,
			bool: { "true": true, "false": false, both: [ true, false, false, false, true ] },
			"undefined": [ undefined, true, false, null, undefined ]
		};
		expect( wtp.decode( wtp.encode( value ) ) ).toEqual( value );
	} );
  
	it( "large object", () => {
		const value = {
			unsigned: [ 1, 2, 3, 4, { b: { c: [ 128, 256, 65536, 4294967296 ] } } ],
			signed: [ -1, -2, -3, -4, { b: { c: [ -33, -129, -32769, -2147483649 ] } } ],
			bin: [ Buffer.from( "abc" ), Buffer.from( "a".repeat( 256 ) ), Buffer.from( "a".repeat( 65535 ) ) ],
			str: [ "abc", "g".repeat( 32 ), "h".repeat( 256 ), "g".repeat( 65535 ) ],
			array: [ [], array( 16 ), array( 256 ) ],
			map: {},
			nil: null,
			bool: { "true": true, "false": false, both: [ true, false, false, false, true ] },
			"undefined": [ undefined, true, false, null, undefined ]
		};
		for ( let i = 0; i < 1024; i++ ) {
			value.map[ "a".repeat( i ) ] = "a".repeat( i );
			value.map[ "b".repeat( i ) ] = Buffer.from( "b".repeat( i ) );
		}
		expect( wtp.decode( wtp.encode( value ) ) ).toEqual( value );
	} );
}

describe( "what-the-pack object", () => {
	const wtp = new MessagePack( 1 << 30 );
	objectTests( wtp );
} );

describe( "what-the-pack object with dictionary", () => {
	const wtp = new MessagePack( 1 << 30 );
	wtp.register( "foo", "bar", "foobar", "unsigned", "signed", "str", "array", "nil", "map", "bool", "both" );
	objectTests( wtp );
} );