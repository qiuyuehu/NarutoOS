// The game delivers some assets inside a light ZWS wrapper. Original-artifact
// verification must compare the decoded bytes, because that is the level the pack
// manifests record as baseSha256.
export function decodeGameSwf(input: Buffer): Buffer {
  if (input.length <= 8 || input.subarray(0, 3).toString('latin1') !== 'ZWS' || input[3] !== 0 ||
      !input.subarray(4, 8).equals(Buffer.alloc(4, 0xff))) {
    return input;
  }
  const header = input.subarray(8, 19);
  const packed = Buffer.alloc(6);
  for (let i = 0; i < packed.length; i++) packed[i] = header[i * 2];
  const restored = Buffer.alloc(3);
  for (let i = 0; i < restored.length; i++) {
    restored[i] = (packed[i * 2] & 0x0f) | ((packed[i * 2 + 1] & 0x0f) << 4);
  }
  const odd = Buffer.alloc(5);
  for (let i = 0; i < odd.length; i++) odd[i] = header[i * 2 + 1];
  const body = Buffer.from(input.subarray(19));
  for (let i = 0; i < Math.min(128, body.length); i++) if (i & 1) body[i] ^= 0xff;
  const decoded = Buffer.concat([restored, odd, body]);
  if (decoded.subarray(0, 3).toString('latin1') !== 'ZWS' || decoded[3] === 0) {
    throw new Error('游戏资源包装解码失败');
  }
  return decoded;
}
