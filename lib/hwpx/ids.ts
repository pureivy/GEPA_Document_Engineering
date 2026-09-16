/** Deterministic id generation so repeated builds of the same DocModel are byte-identical. */
export class IdGen {
  private para = 0;
  private z = 0;
  private seed: number;
  constructor(seed = 0x2f6e2b1) {
    this.seed = seed >>> 0;
  }
  nextParaId(): number {
    return this.para++;
  }
  nextZOrder(): number {
    return this.z++;
  }
  /** pseudo-random positive 31-bit id (xorshift) for hp:tbl / hp:pic ids and instids */
  nextShapeId(): number {
    let x = this.seed;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.seed = x;
    return (x & 0x7fffffff) || 1;
  }
}
