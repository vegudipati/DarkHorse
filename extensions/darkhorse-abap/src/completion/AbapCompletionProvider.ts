import * as vscode from 'vscode';

const ABAP_KEYWORDS = [
  'DATA', 'TYPES', 'CONSTANTS', 'PARAMETERS', 'SELECT-OPTIONS',
  'IF', 'ELSE', 'ELSEIF', 'ENDIF',
  'LOOP', 'ENDLOOP', 'AT', 'ENDAT',
  'DO', 'ENDDO', 'WHILE', 'ENDWHILE',
  'SELECT', 'ENDSELECT', 'INTO', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY',
  'CASE', 'WHEN', 'ENDCASE',
  'TRY', 'CATCH', 'CLEANUP', 'ENDTRY',
  'CLASS', 'ENDCLASS', 'INTERFACE', 'ENDINTERFACE',
  'METHOD', 'ENDMETHOD', 'FORM', 'ENDFORM',
  'FUNCTION', 'ENDFUNCTION', 'MODULE', 'ENDMODULE',
  'CALL', 'PERFORM', 'SUBMIT',
  'READ', 'MODIFY', 'DELETE', 'INSERT', 'APPEND', 'COLLECT', 'SORT',
  'MOVE', 'CLEAR', 'REFRESH', 'FREE',
  'WRITE', 'MESSAGE', 'RAISE',
  'COMMIT WORK', 'ROLLBACK WORK',
  'AUTHORITY-CHECK',
  'PUBLIC', 'PROTECTED', 'PRIVATE', 'SECTION',
  'IMPORTING', 'EXPORTING', 'CHANGING', 'RETURNING', 'RAISING', 'EXCEPTIONS',
  'TYPE', 'LIKE', 'VALUE', 'INITIAL', 'REF TO', 'TYPE REF TO',
  'TABLE OF', 'STANDARD TABLE', 'SORTED TABLE', 'HASHED TABLE',
  'FIELD-SYMBOLS', 'ASSIGN', 'ASSIGNING', 'UNASSIGN',
  'SY-SUBRC', 'SY-TABIX', 'SY-DBCNT', 'SY-UNAME', 'SY-DATUM', 'SY-UZEIT',
  'SY-MANDT', 'SY-LANGU', 'SY-TCODE', 'SY-REPID', 'SY-MSGTY', 'SY-MSGID',
  'ABAP_TRUE', 'ABAP_FALSE', 'SPACE', 'IS INITIAL', 'IS NOT INITIAL',
  'IS BOUND', 'IS NOT BOUND', 'IS SUPPLIED', 'IS NOT SUPPLIED'
];

export class AbapCompletionProvider implements vscode.CompletionItemProvider {

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {

    const linePrefix = document.lineAt(position).text
      .substring(0, position.character)
      .toUpperCase()
      .trimStart();

    // Don't complete inside comments
    if (linePrefix.startsWith('*') || linePrefix.startsWith('"')) {
      return [];
    }

    return ABAP_KEYWORDS.map(keyword => {
      const item = new vscode.CompletionItem(
        keyword,
        vscode.CompletionItemKind.Keyword
      );
      item.detail = 'ABAP keyword';
      item.insertText = keyword;
      return item;
    });
  }
}