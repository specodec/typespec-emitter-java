import {
  EmitContext,
  emitFile,
  Model,
  Type,
} from "@typespec/compiler";
import {
  collectServices,
  BaseEmitterOptions,
  FieldInfo,
  extractFields,
  scalarName,
  isArrayType,
  isRecordType,
  isModelType,
  arrayElementType,
  recordElementType,
  dottedPathToSnakeCase,
  dottedPathToPascalCase,
  toPascalCase,
  toSnakeCase,
  checkAndReportReservedKeywords,
} from "@specodec/typespec-emitter-core";

export type EmitterOptions = BaseEmitterOptions;

// ─── Type mapping ─────────────────────────────────────────────────────────────

function boxedJavaType(type: Type): string {
  if (isArrayType(type)) return `List<${boxedJavaType(arrayElementType(type))}>`;
  if (isRecordType(type)) return `Map<String, ${boxedJavaType(recordElementType(type))}>`;
  const n = scalarName(type);
  if (n) {
    switch (n) {
      case "string": return "String";
      case "boolean": return "Boolean";
      case "int8": return "Byte";
      case "int16": return "Short";
      case "int32": case "integer": return "Integer";
      case "int64": return "Long";
      case "uint8": return "Byte";
      case "uint16": return "Short";
      case "uint32": return "Integer";
      case "uint64": return "Long";
      case "float32": return "Float";
      case "float64": case "float": case "decimal": return "Double";
      case "bytes": return "byte[]";
    }
  }
  if (type.kind === "Model" && (type as Model).name) return (type as Model).name || "Object";
  return "Object";
}

function typeToJava(type: Type): string {
  if (isArrayType(type)) return `List<${boxedJavaType(arrayElementType(type))}>`;
  if (isRecordType(type)) return `Map<String, ${boxedJavaType(recordElementType(type))}>`;
  const n = scalarName(type);
  if (n) {
    switch (n) {
      case "string": return "String";
      case "boolean": return "boolean";
      case "int8": return "byte";
      case "int16": return "short";
      case "int32": case "integer": return "int";
      case "int64": return "long";
      case "uint8": return "byte";
      case "uint16": return "short";
      case "uint32": return "int";
      case "uint64": return "long";
      case "float32": return "float";
      case "float64": case "float": case "decimal": return "double";
      case "bytes": return "byte[]";
    }
  }
  if (type.kind === "Model" && (type as Model).name) return (type as Model).name || "Object";
  return "Object";
}

// ─── Default values ───────────────────────────────────────────────────────────

function defaultValue(type: Type): string {
  if (isArrayType(type)) return "java.util.Collections.emptyList()";
  if (isRecordType(type)) return "java.util.Collections.emptyMap()";
  const n = scalarName(type);
  if (n) {
    switch (n) {
      case "string": return '""';
      case "boolean": return "false";
      case "int8": case "int16": case "int32": case "integer": return "0";
      case "int64": return "0L";
      case "uint8": case "uint16": case "uint32": return "0";
      case "uint64": return "0L";
      case "float32": return "0f";
      case "float64": case "float": case "decimal": return "0.0";
      case "bytes": return "new byte[0]";
    }
  }
  return "null";
}

// ─── Write expression ─────────────────────────────────────────────────────────

function writeExpr(expr: string, type: Type, w: string): string {
  if (isArrayType(type)) {
    const elem = arrayElementType(type);
    return [
      `${w}.beginArray(${expr}.size());`,
      `for (${boxedJavaType(elem)} item : ${expr}) { ${w}.nextElement(); ${writeExpr("item", elem, w)}; }`,
      `${w}.endArray();`,
    ].join("\n        ");
  }
  if (isRecordType(type)) {
    const elem = recordElementType(type);
    return [
      `${w}.beginObject(${expr}.size());`,
      `for (java.util.Map.Entry<String, ${boxedJavaType(elem)}> entry : ${expr}.entrySet()) { ${w}.writeField(entry.getKey()); ${writeExpr("entry.getValue()", elem, w)}; }`,
      `${w}.endObject();`,
    ].join("\n        ");
  }
  const n = scalarName(type);
  if (n) {
    switch (n) {
      case "string": return `${w}.writeString(${expr})`;
      case "boolean": return `${w}.writeBool(${expr})`;
      case "int8": case "int16": return `${w}.writeInt32(${expr})`;
      case "int32": case "integer": return `${w}.writeInt32(${expr})`;
      case "int64": return `${w}.writeInt64(${expr})`;
      case "uint8": return `${w}.writeUint32(${expr} & 0xFF)`;
      case "uint16": return `${w}.writeUint32(${expr} & 0xFFFF)`;
      case "uint32": return `${w}.writeUint32(${expr})`;
      case "uint64": return `${w}.writeUint64(${expr})`;
      case "float32": return `${w}.writeFloat32(${expr})`;
      case "float64": case "float": case "decimal": return `${w}.writeFloat64(${expr})`;
      case "bytes": return `${w}.writeBytes(${expr})`;
    }
  }
  if (type.kind === "Model" && (type as Model).name) return `_write${(type as Model).name}(${w}, ${expr})`;
  return `// TODO: unknown type`;
}

// ─── Simple read expression (scalars and required models) ─────────────────────

function readExprSimple(type: Type, r: string): string {
  const n = scalarName(type);
  if (n) {
    switch (n) {
      case "string": return `${r}.readString()`;
      case "boolean": return `${r}.readBool()`;
      case "int8": return `(byte) ${r}.readInt32()`;
      case "int16": return `(short) ${r}.readInt32()`;
      case "int32": case "integer": return `${r}.readInt32()`;
      case "int64": return `${r}.readInt64()`;
      case "uint8": return `(byte) ${r}.readUint32()`;
      case "uint16": return `(short) ${r}.readUint32()`;
      case "uint32": return `${r}.readUint32()`;
      case "uint64": return `${r}.readUint64()`;
      case "float32": return `${r}.readFloat32()`;
      case "float64": case "float": case "decimal": return `${r}.readFloat64()`;
      case "bytes": return `${r}.readBytes()`;
    }
  }
  if (type.kind === "Model" && (type as Model).name) {
    return `${(type as Model).name}Codec.decode().decode(${r})`;
  }
  return `null`;
}

// ─── Generate model code ──────────────────────────────────────────────────────

function generateModelCode(m: Model): string {
  const fields = extractFields(m);
  const optionalFields = fields.filter(f => f.optional);
  const requiredFields = fields.filter(f => !f.optional);
  const lines: string[] = [];

  // Java record declaration
  if (fields.length === 0) {
    lines.push(`    public record ${m.name}() {}`);
  } else {
    lines.push(`    public record ${m.name}(`);
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const comma = i < fields.length - 1 ? "," : "";
      if (f.optional) {
        lines.push(`        ${boxedJavaType(f.type)} ${f.name}${comma}`);
      } else {
        lines.push(`        ${typeToJava(f.type)} ${f.name}${comma}`);
      }
    }
    lines.push(`    ) {}`);
  }

  lines.push(``);

  // Private write function
  lines.push(`    private static void _write${m.name}(SpecWriter w, ${m.name} obj) {`);
    if (optionalFields.length > 0) {
    lines.push(`        int fieldCount = ${requiredFields.length};`);
    for (const f of optionalFields) lines.push(`        if (obj.${f.name}() != null) fieldCount++;`);
    lines.push(`        w.beginObject(fieldCount);`);
  } else {
    lines.push(`        w.beginObject(${fields.length});`);
  }
  for (const f of fields) {
    if (f.optional) {
      lines.push(`        if (obj.${f.name}() != null) { w.writeField("${f.name}"); ${writeExpr(`obj.${f.name}()`, f.type, "w")}; }`);
    } else {
      lines.push(`        w.writeField("${f.name}"); ${writeExpr(`obj.${f.name}()`, f.type, "w")};`);
    }
  }
  lines.push(`        w.endObject();`);
  lines.push(`    }`);

  lines.push(``);

  // Codec field
  lines.push(`    public static final SpecCodec<${m.name}> ${m.name}Codec = new SpecCodec<>(`);
  lines.push(`        (w, obj) -> _write${m.name}(w, (${m.name}) obj),`);
  lines.push(`        r -> _read${m.name}(r)`);
  lines.push(`    );`);
  lines.push(``);

  // Decode method (extracted to avoid self-reference in initializer)
  lines.push(`    private static ${m.name} _read${m.name}(SpecReader r) {`);

  // Local variables for decode
  for (const f of fields) {
    if (f.optional || isModelType(f.type)) {
      lines.push(`        ${boxedJavaType(f.type)} ${f.name}Val = null;`);
    } else {
      lines.push(`        ${typeToJava(f.type)} ${f.name}Val = ${defaultValue(f.type)};`);
    }
  }

  lines.push(`        r.beginObject();`);
  lines.push(`        while (r.hasNextField()) {`);
  lines.push(`            switch (r.readFieldName()) {`);

  for (const f of fields) {
    lines.push(`                case "${f.name}":`);
    const readLines = generateFieldRead(f, "r", `${f.name}Val`, "                    ");
    lines.push(readLines);
  }
  lines.push(`                default: r.skip(); break;`);

  lines.push(`            }`);
  lines.push(`        }`);
  lines.push(`        r.endObject();`);

  // Constructor
  const ctorArgs = fields.map(f => `${f.name}Val`).join(", ");
  lines.push(`        return new ${m.name}(${ctorArgs});`);
  lines.push(`    }`);

  return lines.join("\n");
}

// ─── Generate field read code ─────────────────────────────────────────────────

function generateFieldRead(f: FieldInfo, r: string, targetVar: string, indent: string): string {
  // Handle optional model separately (needs isNull check with readNull side-effect)
  if (f.optional && isModelType(f.type)) {
    return [
      `${indent}if (${r}.isNull()) { ${r}.readNull(); ${targetVar} = null; }`,
      `${indent}else { ${targetVar} = ${readExprSimple(f.type, r)}; }`,
      `${indent}break;`,
    ].join("\n");
  }

  // For arrays and records, generate block with temp variable
  if (isArrayType(f.type)) {
    return generateArrayRead(f.type, r, targetVar, indent) + `\n${indent}break;`;
  }
  if (isRecordType(f.type)) {
    return generateRecordRead(f.type, r, targetVar, indent) + `\n${indent}break;`;
  }

  // Scalars and required models
  return `${indent}${targetVar} = ${readExprSimple(f.type, r)};\n${indent}break;`;
}

function generateArrayRead(type: Type, r: string, targetVar: string, indent: string): string {
  const elem = arrayElementType(type);
  const javaElem = boxedJavaType(elem);
  const lines: string[] = [];

  lines.push(`${indent}{`);
  lines.push(`${indent}    java.util.ArrayList<${javaElem}> values = new java.util.ArrayList<>();`);
  lines.push(`${indent}    ${r}.beginArray();`);
  lines.push(`${indent}    while (${r}.hasNextElement()) {`);

  if (isArrayType(elem)) {
    const inner = arrayElementType(elem);
    const innerIndent = indent + "        ";
    lines.push(`${innerIndent}java.util.ArrayList<${boxedJavaType(inner)}> innerValues = new java.util.ArrayList<>();`);
    lines.push(`${innerIndent}${r}.beginArray();`);
    lines.push(`${innerIndent}while (${r}.hasNextElement()) {`);
    lines.push(`${innerIndent}    innerValues.add(${readExprSimple(inner, r)});`);
    lines.push(`${innerIndent}}`);
    lines.push(`${innerIndent}${r}.endArray();`);
    lines.push(`${innerIndent}values.add(innerValues);`);
  } else if (isRecordType(elem)) {
    const inner = recordElementType(elem);
    const innerIndent = indent + "        ";
    lines.push(`${innerIndent}java.util.HashMap<String, ${boxedJavaType(inner)}> innerValues = new java.util.HashMap<>();`);
    lines.push(`${innerIndent}${r}.beginObject();`);
    lines.push(`${innerIndent}while (${r}.hasNextField()) {`);
    lines.push(`${innerIndent}    String key = ${r}.readFieldName();`);
    lines.push(`${innerIndent}    innerValues.put(key, ${readExprSimple(inner, r)});`);
    lines.push(`${innerIndent}}`);
    lines.push(`${innerIndent}${r}.endObject();`);
    lines.push(`${innerIndent}values.add(innerValues);`);
  } else {
    lines.push(`${indent}        values.add(${readExprSimple(elem, r)});`);
  }

  lines.push(`${indent}    }`);
  lines.push(`${indent}    ${r}.endArray();`);
  lines.push(`${indent}    ${targetVar} = values;`);
  lines.push(`${indent}}`);

  return lines.join("\n");
}

function generateRecordRead(type: Type, r: string, targetVar: string, indent: string): string {
  const elem = recordElementType(type);
  const javaElem = boxedJavaType(elem);
  const lines: string[] = [];

  lines.push(`${indent}{`);
  lines.push(`${indent}    java.util.HashMap<String, ${javaElem}> values = new java.util.HashMap<>();`);
  lines.push(`${indent}    ${r}.beginObject();`);
  lines.push(`${indent}    while (${r}.hasNextField()) {`);

  if (isArrayType(elem)) {
    const inner = arrayElementType(elem);
    const innerIndent = indent + "        ";
    lines.push(`${innerIndent}String key = ${r}.readFieldName();`);
    lines.push(`${innerIndent}java.util.ArrayList<${boxedJavaType(inner)}> innerValues = new java.util.ArrayList<>();`);
    lines.push(`${innerIndent}${r}.beginArray();`);
    lines.push(`${innerIndent}while (${r}.hasNextElement()) {`);
    lines.push(`${innerIndent}    innerValues.add(${readExprSimple(inner, r)});`);
    lines.push(`${innerIndent}}`);
    lines.push(`${innerIndent}${r}.endArray();`);
    lines.push(`${innerIndent}values.put(key, innerValues);`);
  } else if (isRecordType(elem)) {
    const inner = recordElementType(elem);
    const innerIndent = indent + "        ";
    lines.push(`${innerIndent}String key = ${r}.readFieldName();`);
    lines.push(`${innerIndent}java.util.HashMap<String, ${boxedJavaType(inner)}> innerValues = new java.util.HashMap<>();`);
    lines.push(`${innerIndent}${r}.beginObject();`);
    lines.push(`${innerIndent}while (${r}.hasNextField()) {`);
    lines.push(`${innerIndent}    String innerKey = ${r}.readFieldName();`);
    lines.push(`${innerIndent}    innerValues.put(innerKey, ${readExprSimple(inner, r)});`);
    lines.push(`${innerIndent}}`);
    lines.push(`${innerIndent}${r}.endObject();`);
    lines.push(`${innerIndent}values.put(key, innerValues);`);
  } else {
    lines.push(`${indent}        String key = ${r}.readFieldName();`);
    lines.push(`${indent}        values.put(key, ${readExprSimple(elem, r)});`);
  }

  lines.push(`${indent}    }`);
  lines.push(`${indent}    ${r}.endObject();`);
  lines.push(`${indent}    ${targetVar} = values;`);
  lines.push(`${indent}}`);

  return lines.join("\n");
}

// ─── $onEmit ──────────────────────────────────────────────────────────────────

export async function $onEmit(context: EmitContext<EmitterOptions>) {
  const program = context.program;
  const outputDir = context.emitterOutputDir;
  const ignoreReservedKeywords = context.options["ignore-reserved-keywords"] ?? false;
  const services = collectServices(program);

  if (checkAndReportReservedKeywords(program, services, ignoreReservedKeywords)) return;

  for (const svc of services) {
    const pkg = dottedPathToSnakeCase(svc.serviceName);
    const lines: string[] = [];
    lines.push("// Generated by @specodec/typespec-emitter-java. DO NOT EDIT.");
    lines.push(`package ${pkg};`);
    lines.push(``);
    lines.push(`import java.util.List;`);
    lines.push(`import java.util.Map;`);
    lines.push(`import java.util.ArrayList;`);
    lines.push(`import java.util.HashMap;`);
    lines.push(`import specodec.*;`);
    lines.push(``);
    lines.push(`public class ${dottedPathToPascalCase(svc.serviceName)}Types {`);
    for (const m of svc.models) {
      if (!m.name) continue;
      lines.push(generateModelCode(m));
      lines.push(``);
    }
    lines.push(`}`);
    lines.push(``);

    const fileName = `${dottedPathToPascalCase(svc.serviceName)}Types.java`;
    await emitFile(program, { path: `${outputDir}/${fileName}`, content: lines.join("\n") });
  }
}
