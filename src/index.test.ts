import { existsSync, readdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { mkScalar, mkArray } from '@specodec/typespec-emitter-core/test-utils';
import { typeToJava, readExprSimple, writeExpr, writeLines, defaultValue } from './index.js';

describe('typeToJava', () => {
  it('string → String', () => expect(typeToJava(mkScalar('string') as any)).toBe('String'));
  it('boolean → boolean', () => expect(typeToJava(mkScalar('boolean') as any)).toBe('boolean'));
  it('int32 → int', () => expect(typeToJava(mkScalar('int32') as any)).toBe('int'));
  it('int64 → long', () => expect(typeToJava(mkScalar('int64') as any)).toBe('long'));
  it('float32 → float', () => expect(typeToJava(mkScalar('float32') as any)).toBe('float'));
  it('float64 → double', () => expect(typeToJava(mkScalar('float64') as any)).toBe('double'));
  it('bytes → byte[]', () => expect(typeToJava(mkScalar('bytes') as any)).toBe('byte[]'));
  it('model → model name', () => expect(typeToJava({ kind: 'Model', name: 'User' } as any)).toBe('User'));
});

describe('readExpr', () => {
  it('int32', () => expect(readExprSimple(mkScalar('int32') as any)).toContain('readInt32'));
  it('string', () => expect(readExprSimple(mkScalar('string') as any)).toContain('readString'));
  it('bool', () => expect(readExprSimple(mkScalar('boolean') as any)).toContain('readBool'));
  it('float32', () => expect(readExprSimple(mkScalar('float32') as any)).toContain('readFloat32'));
  it('bytes', () => expect(readExprSimple(mkScalar('bytes') as any)).toContain('readBytes'));
});

describe('generation + compile', () => {
  const ROOT = join(__dir, '..');
  const TSP = join(ROOT, 'node_modules', '.bin', 'tsp');
  const TDIR = join(ROOT, 'tests');
  const GEN = join(TDIR, 'generated');

  it('tsp generates ~200 codec files', () => {
    if (existsSync(GEN)) rmSync(GEN, { recursive: true });
    execSync(`${TSP} compile alltypes.tsp --emit=@specodec/typespec-emitter-java --option @specodec/typespec-emitter-java.emitter-output-dir=generated`, { cwd: TDIR, stdio: 'pipe' });
    expect(readdirSync(GEN).length).toBeGreaterThanOrEqual(10);
  });
});
