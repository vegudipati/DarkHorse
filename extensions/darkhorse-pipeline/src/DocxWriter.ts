import * as fs from 'fs';
import { FdsDocument } from './FdsGenerator';

// TdsDocument defined inline here until TdsGenerator is built in Phase 4
export interface TdsDocument {
  title: string;
  author: string;
  version: string;
  date: string;
  status: 'Draft' | 'Review' | 'Approved';
  fdsReference: string;
  sections: {
    technicalApproach: string;
    designDecisions: string[];
    abapObjectList: Array<{
      sequence: number;
      objectType: string;
      objectName: string;
      description: string;
      keyLogic: string[];
      dependencies: string[];
    }>;
    dataDictionary: string;
    programLogic: string;
    interfaceDesign: string;
    dbDesign: string;
    errorHandling: string;
    transportStrategy: string;
    testScenarios: Array<{ id: string; description: string; expected: string }>;
    openItems: string[];
  };
}

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat
} = require('docx');

export class DocxWriter {

  /**
   * Write FDS document to .docx file
   */
  public static async writeFds(fds: FdsDocument, filePath: string): Promise<void> {
    const doc = DocxWriter.buildFdsDoc(fds);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Write TDS document to .docx file
   */
  public static async writeTds(tds: TdsDocument, filePath: string): Promise<void> {
    const doc = DocxWriter.buildTdsDoc(tds);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }

  // ─── FDS Builder ──────────────────────────────────────────────────

  private static buildFdsDoc(fds: FdsDocument): any {
    const children: any[] = [];

    // Title page
    children.push(DocxWriter.heading(fds.title, 1));
    children.push(DocxWriter.heading('Functional Design Specification', 2));
    children.push(DocxWriter.spacer());
    children.push(DocxWriter.makeTable(
      ['Field', 'Value'],
      [
        ['Document Title', fds.title],
        ['Author', fds.author],
        ['Version', fds.version],
        ['Date', fds.date],
        ['Status', fds.status],
        ['RICEFW Type', fds.ricefwType],
        ['BR Reference', fds.brReference],
      ],
      [3000, 6000]
    ));
    children.push(DocxWriter.spacer());

    // Section 1
    children.push(DocxWriter.heading('1. Business Background & Objectives', 2));
    children.push(DocxWriter.para(fds.sections.businessBackground));
    children.push(DocxWriter.spacer());

    // Section 2
    children.push(DocxWriter.heading('2. Scope', 2));
    children.push(DocxWriter.heading('In Scope', 3));
    fds.sections.scope.inScope.forEach(item => children.push(DocxWriter.bullet(item)));
    children.push(DocxWriter.heading('Out of Scope', 3));
    fds.sections.scope.outOfScope.forEach(item => children.push(DocxWriter.bullet(item)));
    children.push(DocxWriter.spacer());

    // Section 3
    children.push(DocxWriter.heading('3. Business Process Overview', 2));
    children.push(DocxWriter.para(fds.sections.processOverview));
    children.push(DocxWriter.spacer());

    // Section 4 — Functional Requirements table
    children.push(DocxWriter.heading('4. Functional Requirements', 2));
    if (fds.sections.functionalRequirements.length > 0) {
      children.push(DocxWriter.makeTable(
        ['ID', 'Description', 'Priority'],
        fds.sections.functionalRequirements.map(fr => [fr.id, fr.description, fr.priority]),
        [1500, 6000, 1500]
      ));
    }
    children.push(DocxWriter.spacer());

    // Section 5
    children.push(DocxWriter.heading('5. User Interface / Screen Design', 2));
    children.push(DocxWriter.para(fds.sections.uiDesign));
    children.push(DocxWriter.spacer());

    // Section 6
    children.push(DocxWriter.heading('6. Input / Output Specifications', 2));
    children.push(DocxWriter.para(fds.sections.inputOutputSpec));
    children.push(DocxWriter.spacer());

    // Section 7
    children.push(DocxWriter.heading('7. Business Rules & Validations', 2));
    fds.sections.businessRules.forEach(rule => children.push(DocxWriter.bullet(rule)));
    children.push(DocxWriter.spacer());

    // Section 8
    children.push(DocxWriter.heading('8. Error Handling & Messages', 2));
    fds.sections.errorHandling.forEach(err => children.push(DocxWriter.bullet(err)));
    children.push(DocxWriter.spacer());

    // Section 9
    children.push(DocxWriter.heading('9. Authorization & Security', 2));
    children.push(DocxWriter.para(fds.sections.authorization));
    children.push(DocxWriter.spacer());

    // Section 10
    children.push(DocxWriter.heading('10. Reporting Requirements', 2));
    children.push(DocxWriter.para(fds.sections.reportingRequirements));
    children.push(DocxWriter.spacer());

    // Section 11
    children.push(DocxWriter.heading('11. Open Items / Assumptions / Dependencies', 2));
    fds.sections.openItems.forEach(item => children.push(DocxWriter.bullet(item)));
    children.push(DocxWriter.spacer());

  return new Document({
      numbering: DocxWriter.getNumbering(),
      styles: DocxWriter.getStyles(),
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children
      }]
    });
  }

  // ─── TDS Builder ──────────────────────────────────────────────────

  private static buildTdsDoc(tds: TdsDocument): any {
    const children: any[] = [];

    // Header
    children.push(DocxWriter.heading(tds.title, 1));
    children.push(DocxWriter.heading('Technical Design Specification', 2));
    children.push(DocxWriter.spacer());
    children.push(DocxWriter.makeTable(
      ['Field', 'Value'],
      [
        ['Document Title', tds.title],
        ['Author', tds.author],
        ['Version', tds.version],
        ['Date', tds.date],
        ['Status', tds.status],
        ['FDS Reference', tds.fdsReference],
      ],
      [3000, 6000]
    ));
    children.push(DocxWriter.spacer());

    // Section 1
    children.push(DocxWriter.heading('1. Technical Approach & Design Decisions', 2));
    children.push(DocxWriter.para(tds.sections.technicalApproach));
    children.push(DocxWriter.spacer());
    tds.sections.designDecisions.forEach(d => children.push(DocxWriter.bullet(d)));
    children.push(DocxWriter.spacer());

    // Section 2 — ABAP Object List
    children.push(DocxWriter.heading('2. ABAP Object List', 2));
    if (tds.sections.abapObjectList.length > 0) {
      children.push(DocxWriter.makeTable(
        ['#', 'Type', 'Object Name', 'Description'],
        tds.sections.abapObjectList.map(obj => [
          String(obj.sequence),
          obj.objectType,
          obj.objectName,
          obj.description
        ]),
        [800, 1500, 2500, 4200]
      ));
    }
    children.push(DocxWriter.spacer());

    // Section 3
    children.push(DocxWriter.heading('3. Data Dictionary Objects', 2));
    children.push(DocxWriter.para(tds.sections.dataDictionary));
    children.push(DocxWriter.spacer());

    // Section 4 — Program Logic per object
    children.push(DocxWriter.heading('4. Program Logic', 2));
    tds.sections.abapObjectList.forEach(obj => {
      children.push(DocxWriter.heading(`${obj.sequence}. ${obj.objectName}`, 3));
      children.push(DocxWriter.para(obj.description));
      obj.keyLogic.forEach(logic => children.push(DocxWriter.bullet(logic)));
      children.push(DocxWriter.spacer());
    });

    // Section 5
    children.push(DocxWriter.heading('5. Interface / Integration Design', 2));
    children.push(DocxWriter.para(tds.sections.interfaceDesign));
    children.push(DocxWriter.spacer());

    // Section 6
    children.push(DocxWriter.heading('6. Database Design & Performance', 2));
    children.push(DocxWriter.para(tds.sections.dbDesign));
    children.push(DocxWriter.spacer());

    // Section 7
    children.push(DocxWriter.heading('7. Error Handling & Logging', 2));
    children.push(DocxWriter.para(tds.sections.errorHandling));
    children.push(DocxWriter.spacer());

    // Section 8
    children.push(DocxWriter.heading('8. Transport Strategy', 2));
    children.push(DocxWriter.para(tds.sections.transportStrategy));
    children.push(DocxWriter.spacer());

    // Section 9 — Test Scenarios
    children.push(DocxWriter.heading('9. Unit Test Scenarios', 2));
    if (tds.sections.testScenarios.length > 0) {
      children.push(DocxWriter.makeTable(
        ['ID', 'Description', 'Expected Result'],
        tds.sections.testScenarios.map(t => [t.id, t.description, t.expected]),
        [1500, 4000, 3500]
      ));
    }
    children.push(DocxWriter.spacer());

    // Section 10
    children.push(DocxWriter.heading('10. Open Items / Assumptions / Dependencies', 2));
    tds.sections.openItems.forEach(item => children.push(DocxWriter.bullet(item)));

  return new Document({
      numbering: DocxWriter.getNumbering(),
      styles: DocxWriter.getStyles(),
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children
      }]
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private static heading(text: string, level: 1 | 2 | 3): any {
    const levels: Record<number, any> = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3
    };
    return new Paragraph({
      heading: levels[level],
      children: [new TextRun({ text, font: 'Arial', bold: true })]
    });
  }

  private static para(text: string): any {
    return new Paragraph({
      children: [new TextRun({ text: text ?? '', font: 'Arial', size: 22 })]
    });
  }

  private static bullet(text: string): any {
    return new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      children: [new TextRun({ text: text ?? '', font: 'Arial', size: 22 })]
    });
  }

  private static spacer(): any {
    return new Paragraph({ children: [new TextRun('')] });
  }

  private static makeTable(headers: string[], rows: string[][], colWidths: number[]): any {
    const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
    const borders = { top: border, bottom: border, left: border, right: border };

    return new Table({
      width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnWidths: colWidths,
      rows: [
        new TableRow({
          children: headers.map((h, i) => new TableCell({
            borders,
            width: { size: colWidths[i], type: WidthType.DXA },
            shading: { fill: '1A1A2E', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', font: 'Arial', size: 20 })]
            })]
          }))
        }),
        ...rows.map((row, ri) => new TableRow({
          children: row.map((cell, ci) => new TableCell({
            borders,
            width: { size: colWidths[ci], type: WidthType.DXA },
            shading: { fill: ri % 2 === 0 ? 'F4F6F9' : 'FFFFFF', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: cell ?? '', font: 'Arial', size: 20 })]
            })]
          }))
        }))
      ]
    });
  }

  private static getStyles(): any {
    return {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal',
          run: { size: 32, bold: true, font: 'Arial', color: '1A1A2E' },
          paragraph: { spacing: { before: 300, after: 200 } }
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal',
          run: { size: 26, bold: true, font: 'Arial', color: '2E4057' },
          paragraph: { spacing: { before: 240, after: 160 } }
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal',
          run: { size: 24, bold: true, font: 'Arial', color: '3D5A80' },
          paragraph: { spacing: { before: 180, after: 120 } }
        }
      ]
    };
  }

  private static getNumbering(): any {
    return {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }]
    };
  }
}