/**
 * AbapGitWriter — CPI-6 A7 abapGit-layout output.
 *
 * Writes each generated SAP object into the abapGit folder convention so the
 * configured output folder is itself a valid abapGit repo that the developer
 * can `cloneTo` from ADT (Eclipse) and push back into an S/4HANA system. The
 * goal is not perfect roundtripping — that requires the system to fill in
 * deep metadata — but enough that abapGit recognises the layout, lists each
 * object, and lets the developer review / activate / commit from inside ADT.
 *
 * Layout:
 *
 *   <outputFolder>/
 *     .abapgit.xml               <-- repo config; STARTING_FOLDER=/src/
 *     src/
 *       package.devc.xml          <-- describes the package once
 *       zcl_foo.clas.abap         <-- ABAP source for objects with source
 *       zcl_foo.clas.xml          <-- abapGit metadata for the object
 *       zi_foo.ddls.asddls        <-- DDL source-only objects use .as* ext
 *       ...
 *
 * Per-object-type extension map (lowercased name + type + format):
 *
 *   PROG -> .prog.abap + .prog.xml
 *   CLAS -> .clas.abap + .clas.xml
 *   INTF -> .intf.abap + .intf.xml
 *   FUNC -> .fugr.abap + .fugr.xml   (treated as fugr at the writer level)
 *   TABL -> .tabl.xml                 (DDIC, no ABAP source file)
 *   DDLS -> .ddls.asddls              (CDS interface/consumption views)
 *   BDEF -> .bdef.asbdef
 *   SRVD -> .srvd.srvd.asddls         (yes — SRVD uses asddls dialect)
 *   SRVB -> .srvb.xml                 (binding is metadata-only)
 *   DCLS -> .dcls.asdcls
 *   DDLX -> .ddlx.asddlx
 *
 * Companion XML emitted for: PROG, CLAS, INTF, FUNC, TABL, SRVB. Other object
 * types are source-only in modern abapGit. The XML is minimal but well-formed
 * — abapGit fills in the rest on pull/push.
 *
 * IDEMPOTENCY:
 *   - .abapgit.xml and src/package.devc.xml are written once per output
 *     folder; if they already exist their content is left untouched (the
 *     developer may have customized STARTING_FOLDER or the package name).
 *   - Source / metadata files for objects are overwritten on every save.
 */

'use strict';

import * as fs   from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Type -> extension mapping
// ---------------------------------------------------------------------------

interface FilePlan {
  sourceFile:   string | null;   // null = no .abap-style source file
  sourceCode:   string | null;
  metadataFile: string | null;   // null = no companion XML for this type
  metadataXml:  string | null;
}

function buildFilePlan(
  objectName:  string,
  objectType:  string,
  description: string,
  code:        string
): FilePlan {
  const t = (objectType ?? '').trim().toUpperCase();
  const n = (objectName ?? '').trim();
  const lower = n.toLowerCase();
  const safeDesc = escapeXml(description ?? n);

  switch (t) {
    case 'PROG':
      return {
        sourceFile:   `${lower}.prog.abap`,
        sourceCode:   code,
        metadataFile: `${lower}.prog.xml`,
        metadataXml:  progXml(n.toUpperCase(), safeDesc)
      };
    case 'CLAS':
      return {
        sourceFile:   `${lower}.clas.abap`,
        sourceCode:   code,
        metadataFile: `${lower}.clas.xml`,
        metadataXml:  clasXml(n.toUpperCase(), safeDesc)
      };
    case 'INTF':
      return {
        sourceFile:   `${lower}.intf.abap`,
        sourceCode:   code,
        metadataFile: `${lower}.intf.xml`,
        metadataXml:  intfXml(n.toUpperCase(), safeDesc)
      };
    case 'FUNC':
    case 'FUGR':
      return {
        sourceFile:   `${lower}.fugr.abap`,
        sourceCode:   code,
        metadataFile: `${lower}.fugr.xml`,
        metadataXml:  fugrXml(n.toUpperCase(), safeDesc)
      };
    case 'TABL':
      // DDIC tables have no .abap source — the structure is XML-defined.
      // We emit the AI's text into a companion .source.txt so the developer
      // can copy the field list into SE11 / ADT.
      return {
        sourceFile:   `${lower}.tabl.source.txt`,
        sourceCode:   code,
        metadataFile: `${lower}.tabl.xml`,
        metadataXml:  tablXml(n.toUpperCase(), safeDesc)
      };
    case 'DDLS':
      return {
        sourceFile:   `${lower}.ddls.asddls`,
        sourceCode:   code,
        metadataFile: null,
        metadataXml:  null
      };
    case 'BDEF':
      return {
        sourceFile:   `${lower}.bdef.asbdef`,
        sourceCode:   code,
        metadataFile: null,
        metadataXml:  null
      };
    case 'SRVD':
      return {
        sourceFile:   `${lower}.srvd.srvd.asddls`,
        sourceCode:   code,
        metadataFile: null,
        metadataXml:  null
      };
    case 'SRVB':
      // Service bindings are metadata-only. The generated "code" is the
      // declarative shape the LLM produced; we keep it as a .source.txt for
      // reference and emit the actual XML next to it.
      return {
        sourceFile:   `${lower}.srvb.source.txt`,
        sourceCode:   code,
        metadataFile: `${lower}.srvb.xml`,
        metadataXml:  srvbXml(n.toUpperCase(), safeDesc, deriveSrvdNameFromBinding(n))
      };
    case 'DCLS':
      return {
        sourceFile:   `${lower}.dcls.asdcls`,
        sourceCode:   code,
        metadataFile: null,
        metadataXml:  null
      };
    case 'DDLX':
      return {
        sourceFile:   `${lower}.ddlx.asddlx`,
        sourceCode:   code,
        metadataFile: null,
        metadataXml:  null
      };
    default:
      // Unknown type — fall back to flat .abap so the source is at least
      // recoverable. abapGit will not import this, but the developer can
      // re-classify the object and rename manually.
      return {
        sourceFile:   `${lower}.${t.toLowerCase() || 'unknown'}.abap`,
        sourceCode:   code,
        metadataFile: null,
        metadataXml:  null
      };
  }
}

function deriveSrvdNameFromBinding(srvbName: string): string {
  // Convention: ZUI_FOO_O4 -> ZUI_FOO. Strip the trailing _O4 / _O2 suffix.
  return srvbName.toUpperCase().replace(/_O[24]$/, '');
}

// ---------------------------------------------------------------------------
// XML emitters — minimal but well-formed abapGit-compatible metadata
// ---------------------------------------------------------------------------

function progXml(name: string, descr: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <PROGDIR>`,
    `    <NAME>${name}</NAME>`,
    `    <SUBC>1</SUBC>`,
    `    <APPL>S</APPL>`,
    `    <RLOAD>E</RLOAD>`,
    `    <FIXPT>X</FIXPT>`,
    `    <UCCHECK>X</UCCHECK>`,
    `   </PROGDIR>`,
    `   <TPOOL>`,
    `    <item>`,
    `     <ID>R</ID>`,
    `     <ENTRY>${descr}</ENTRY>`,
    `     <LENGTH>0</LENGTH>`,
    `    </item>`,
    `   </TPOOL>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function clasXml(name: string, descr: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <VSEOCLASS>`,
    `    <CLSNAME>${name}</CLSNAME>`,
    `    <LANGU>E</LANGU>`,
    `    <DESCRIPT>${descr}</DESCRIPT>`,
    `    <STATE>1</STATE>`,
    `    <CLSCCINCL>X</CLSCCINCL>`,
    `    <FIXPT>X</FIXPT>`,
    `    <UNICODE>X</UNICODE>`,
    `   </VSEOCLASS>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function intfXml(name: string, descr: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_INTF" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <VSEOINTERF>`,
    `    <CLSNAME>${name}</CLSNAME>`,
    `    <LANGU>E</LANGU>`,
    `    <DESCRIPT>${descr}</DESCRIPT>`,
    `    <EXPOSURE>2</EXPOSURE>`,
    `    <STATE>1</STATE>`,
    `    <UNICODE>X</UNICODE>`,
    `   </VSEOINTERF>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function fugrXml(name: string, descr: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_FUGR" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <AREAT>${descr}</AREAT>`,
    `   <INCLUDES>`,
    `    <SOBJ_NAME>L${name}TOP</SOBJ_NAME>`,
    `    <SOBJ_NAME>SAPL${name}</SOBJ_NAME>`,
    `   </INCLUDES>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function tablXml(name: string, descr: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <DD02V>`,
    `    <TABNAME>${name}</TABNAME>`,
    `    <DDLANGUAGE>E</DDLANGUAGE>`,
    `    <TABCLASS>TRANSP</TABCLASS>`,
    `    <DDTEXT>${descr}</DDTEXT>`,
    `    <MAINFLAG>X</MAINFLAG>`,
    `    <CONTFLAG>A</CONTFLAG>`,
    `   </DD02V>`,
    `   <DD09L>`,
    `    <TABNAME>${name}</TABNAME>`,
    `    <AS4LOCAL>A</AS4LOCAL>`,
    `    <TABKAT>1</TABKAT>`,
    `    <TABART>APPL1</TABART>`,
    `    <BUFALLOW>N</BUFALLOW>`,
    `   </DD09L>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function srvbXml(name: string, descr: string, serviceName: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_SRVB" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <BINDING_HEADER>`,
    `    <NAME>${name}</NAME>`,
    `    <TYPE>SRVB</TYPE>`,
    `    <DESCRIPTION>${descr}</DESCRIPTION>`,
    `    <BINDING_TYPE>ODATA_V4</BINDING_TYPE>`,
    `    <SERVICE_NAME>${serviceName}</SERVICE_NAME>`,
    `   </BINDING_HEADER>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function escapeXml(input: string): string {
  return (input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Root config files — idempotent
// ---------------------------------------------------------------------------

const ABAPGIT_DOTFILE = '.abapgit.xml';

function abapgitDotfileXml(packageName: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_DOT_ABAPGIT" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <DATA>`,
    `    <MASTER_LANGUAGE>E</MASTER_LANGUAGE>`,
    `    <STARTING_FOLDER>/src/</STARTING_FOLDER>`,
    `    <FOLDER_LOGIC>FULL</FOLDER_LOGIC>`,
    `    <IGNORE>`,
    `     <item>/.gitignore</item>`,
    `     <item>/LICENSE</item>`,
    `     <item>/README.md</item>`,
    `     <item>/package.json</item>`,
    `     <item>/.travis.yml</item>`,
    `    </IGNORE>`,
    `    <REQUIREMENTS/>`,
    `    <PACKAGING>`,
    `     <PACKAGE>${escapeXml(packageName)}</PACKAGE>`,
    `    </PACKAGING>`,
    `   </DATA>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

function packageDevcXml(packageName: string): string {
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">`,
    ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">`,
    `  <asx:values>`,
    `   <DEVC>`,
    `    <CTEXT>DarkHorse-generated package ${escapeXml(packageName)}</CTEXT>`,
    `    <DLVUNIT>HOME</DLVUNIT>`,
    `    <AS4USER>DARKHORSE</AS4USER>`,
    `    <PDEVCLASS>$TMP</PDEVCLASS>`,
    `   </DEVC>`,
    `  </asx:values>`,
    ` </asx:abap>`,
    `</abapGit>`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SaveResult {
  sourcePath:   string | null;
  metadataPath: string | null;
}

export function saveAbapGit(opts: {
  objectName:   string;
  objectType:   string;
  description:  string;
  code:         string;
  outputFolder: string;
  packageName:  string;
}): SaveResult {
  ensureRootConfig(opts.outputFolder, opts.packageName);

  const srcDir = path.join(opts.outputFolder, 'src');
  if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

  const plan = buildFilePlan(opts.objectName, opts.objectType, opts.description, opts.code);

  let sourcePath:   string | null = null;
  let metadataPath: string | null = null;

  if (plan.sourceFile && plan.sourceCode !== null) {
    sourcePath = path.join(srcDir, plan.sourceFile);
    fs.writeFileSync(sourcePath, plan.sourceCode, 'utf8');
  }
  if (plan.metadataFile && plan.metadataXml) {
    metadataPath = path.join(srcDir, plan.metadataFile);
    fs.writeFileSync(metadataPath, plan.metadataXml, 'utf8');
  }
  return { sourcePath, metadataPath };
}

/** Write .abapgit.xml + src/package.devc.xml IF they don't already exist.
 *  Existing files are left alone so the developer can customise STARTING_FOLDER,
 *  package metadata, ignore list, etc. between runs. */
function ensureRootConfig(outputFolder: string, packageName: string): void {
  if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
  const dotfile = path.join(outputFolder, ABAPGIT_DOTFILE);
  if (!fs.existsSync(dotfile)) {
    fs.writeFileSync(dotfile, abapgitDotfileXml(packageName), 'utf8');
  }
  const srcDir = path.join(outputFolder, 'src');
  if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
  const devcFile = path.join(srcDir, 'package.devc.xml');
  if (!fs.existsSync(devcFile)) {
    fs.writeFileSync(devcFile, packageDevcXml(packageName), 'utf8');
  }
}
