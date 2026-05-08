REPORT zfin_open_items.

*--------------------------------------------------------------------*
* Finance Open Items Report - displays open customer line items
* for cash flow analysis
*--------------------------------------------------------------------*

TABLES: bsid, kna1.

TYPES: BEGIN OF ty_open_items,
         bukrs TYPE bsid-bukrs,
         kunnr TYPE bsid-kunnr,
         augdt TYPE bsid-augdt,
         augbl TYPE bsid-augbl,
         zuonr TYPE bsid-zuonr,
         gjahr TYPE bsid-gjahr,
         belnr TYPE bsid-belnr,
         buzei TYPE bsid-buzei,
         budat TYPE bsid-budat,
         bldat TYPE bsid-bldat,
         cpudt TYPE bsid-cpudt,
         waers TYPE bsid-waers,
         dmbtr TYPE bsid-dmbtr,
         wrbtr TYPE bsid-wrbtr,
         shkzg TYPE bsid-shkzg,
         mwskz TYPE bsid-mwskz,
         sgtxt TYPE bsid-sgtxt,
         name1 TYPE kna1-name1,
         land1 TYPE kna1-land1,
       END OF ty_open_items.

DATA: gt_open_items TYPE TABLE OF ty_open_items,
      gt_fieldcat   TYPE slis_t_fieldcat_alv,
      gs_layout     TYPE slis_layout_alv.

SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
PARAMETERS: p_bukrs TYPE bukrs OBLIGATORY.
SELECT-OPTIONS: s_budat FOR bsid-budat.
SELECTION-SCREEN END OF BLOCK b1.

*--------------------------------------------------------------------*
* AT SELECTION-SCREEN-ON VALUE-REQUEST
*--------------------------------------------------------------------*
AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_bukrs.
  CALL FUNCTION 'F4_COMP_CODE'
    EXPORTING
      comp_code = p_bukrs
    IMPORTING
      return    = p_bukrs.

*--------------------------------------------------------------------*
* AT SELECTION-SCREEN
*--------------------------------------------------------------------*
AT SELECTION-SCREEN.
  " Authority check for company code
  AUTHORITY-CHECK OBJECT 'F_BKPF_BUK'
    ID 'BUKRS' FIELD p_bukrs
    ID 'ACTVT' FIELD '03'.
  
  IF sy-subrc NE 0.
    MESSAGE e001(zfin) WITH 'No authorization for company code' p_bukrs.
  ENDIF.

*--------------------------------------------------------------------*
* START-OF-SELECTION
*--------------------------------------------------------------------*
START-OF-SELECTION.
  PERFORM get_open_items.
  PERFORM prepare_alv_display.
  PERFORM display_alv.

*--------------------------------------------------------------------*
* GET_OPEN_ITEMS
*--------------------------------------------------------------------*
FORM get_open_items.
  DATA: lv_where TYPE string.
  
  " Build dynamic WHERE clause for posting date
  IF s_budat[] IS NOT INITIAL.
    lv_where = | AND bsid~budat IN @s_budat|.
  ENDIF.
  
  " Execute optimized SELECT with LEFT JOIN
  SELECT bsid~bukrs,
         bsid~kunnr,
         bsid~augdt,
         bsid~augbl,
         bsid~zuonr,
         bsid~gjahr,
         bsid~belnr,
         bsid~buzei,
         bsid~budat,
         bsid~bldat,
         bsid~cpudt,
         bsid~waers,
         bsid~dmbtr,
         bsid~wrbtr,
         bsid~shkzg,
         bsid~mwskz,
         bsid~sgtxt,
         kna1~name1,
         kna1~land1
    FROM bsid
    LEFT OUTER JOIN kna1 ON bsid~kunnr = kna1~kunnr
    INTO TABLE @gt_open_items
    UP TO 50000 ROWS
    WHERE bsid~bukrs = @p_bukrs
      AND bsid~augbl = @space
      (lv_where).
  
  IF sy-subrc = 0.
    SORT gt_open_items BY bukrs kunnr budat.
    MESSAGE s002(zfin) WITH sy-dbcnt 'open items found'.
  ELSE.
    MESSAGE s003(zfin) WITH 'No open items found'.
  ENDIF.
ENDFORM.

*--------------------------------------------------------------------*
* PREPARE_ALV_DISPLAY
*--------------------------------------------------------------------*
FORM prepare_alv_display.
  DATA: ls_fieldcat TYPE slis_fieldcat_alv.
  
  CLEAR: gt_fieldcat[], gs_layout.
  
  " Company Code
  ls_fieldcat-col_pos = 1.
  ls_fieldcat-fieldname = 'BUKRS'.
  ls_fieldcat-seltext_m = 'Company Code'.
  ls_fieldcat-outputlen = 4.
  ls_fieldcat-key = 'X'.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Customer Number
  ls_fieldcat-col_pos = 2.
  ls_fieldcat-fieldname = 'KUNNR'.
  ls_fieldcat-seltext_m = 'Customer'.
  ls_fieldcat-outputlen = 10.
  ls_fieldcat-key = 'X'.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Customer Name
  ls_fieldcat-col_pos = 3.
  ls_fieldcat-fieldname = 'NAME1'.
  ls_fieldcat-seltext_m = 'Customer Name'.
  ls_fieldcat-outputlen = 35.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Fiscal Year
  ls_fieldcat-col_pos = 4.
  ls_fieldcat-fieldname = 'GJAHR'.
  ls_fieldcat-seltext_m = 'Fiscal Year'.
  ls_fieldcat-outputlen = 4.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Document Number
  ls_fieldcat-col_pos = 5.
  ls_fieldcat-fieldname = 'BELNR'.
  ls_fieldcat-seltext_m = 'Document Number'.
  ls_fieldcat-outputlen = 10.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Line Item
  ls_fieldcat-col_pos = 6.
  ls_fieldcat-fieldname = 'BUZEI'.
  ls_fieldcat-seltext_m = 'Item'.
  ls_fieldcat-outputlen = 3.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Posting Date
  ls_fieldcat-col_pos = 7.
  ls_fieldcat-fieldname = 'BUDAT'.
  ls_fieldcat-seltext_m = 'Posting Date'.
  ls_fieldcat-outputlen = 10.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Document Date
  ls_fieldcat-col_pos = 8.
  ls_fieldcat-fieldname = 'BLDAT'.
  ls_fieldcat-seltext_m = 'Document Date'.
  ls_fieldcat-outputlen = 10.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Currency
  ls_fieldcat-col_pos = 9.
  ls_fieldcat-fieldname = 'WAERS'.
  ls_fieldcat-seltext_m = 'Currency'.
  ls_fieldcat-outputlen = 5.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Amount in Local Currency
  ls_fieldcat-col_pos = 10.
  ls_fieldcat-fieldname = 'DMBTR'.
  ls_fieldcat-seltext_m = 'LC Amount'.
  ls_fieldcat-outputlen = 15.
  ls_fieldcat-do_sum = 'X'.
  ls_fieldcat-datatype = 'CURR'.
  ls_fieldcat-cfieldname = 'WAERS'.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Amount in Document Currency
  ls_fieldcat-col_pos = 11.
  ls_fieldcat-fieldname = 'WRBTR'.
  ls_fieldcat-seltext_m = 'Doc Amount'.
  ls_fieldcat-outputlen = 15.
  ls_fieldcat-do_sum = 'X'.
  ls_fieldcat-datatype = 'CURR'.
  ls_fieldcat-cfieldname = 'WAERS'.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Debit/Credit Indicator
  ls_fieldcat-col_pos = 12.
  ls_fieldcat-fieldname = 'SHKZG'.
  ls_fieldcat-seltext_m = 'D/C'.
  ls_fieldcat-outputlen = 1.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Assignment
  ls_fieldcat-col_pos = 13.
  ls_fieldcat-fieldname = 'ZUONR'.
  ls_fieldcat-seltext_m = 'Assignment'.
  ls_fieldcat-outputlen = 18.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Text
  ls_fieldcat-col_pos = 14.
  ls_fieldcat-fieldname = 'SGTXT'.
  ls_fieldcat-seltext_m = 'Text'.
  ls_fieldcat-outputlen = 50.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Country
  ls_fieldcat-col_pos = 15.
  ls_fieldcat-fieldname = 'LAND1'.
  ls_fieldcat-seltext_m = 'Country'.
  ls_fieldcat-outputlen = 3.
  APPEND ls_fieldcat TO gt_fieldcat.
  CLEAR ls_fieldcat.
  
  " Layout settings
  gs_layout-zebra = 'X'.
  gs_layout-colwidth_optimize = 'X'.
  gs_layout-detail_popup = 'X'.
ENDFORM.

*--------------------------------------------------------------------*
* DISPLAY_ALV
*--------------------------------------------------------------------*
FORM display_alv.
  DATA: lv_title TYPE sy-title.
  
  lv_title = |Finance Open Items Report - Company Code { p_bukrs }|.
  
  CALL FUNCTION 'REUSE_ALV_GRID_DISPLAY'
    EXPORTING
      i_callback_program       = sy-repid
      i_callback_top_of_page   = 'TOP_OF_PAGE'
      i_callback_user_command  = 'USER_COMMAND'
      is_layout                = gs_layout
      it_fieldcat              = gt_fieldcat
      i_save                   = 'X'
      i_default                = 'X'
    TABLES
      t_outtab                 = gt_open_items
    EXCEPTIONS
      program_error            = 1
      OTHERS                   = 2.
  
  IF sy-subrc <> 0.
    MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
            WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
  ENDIF.
ENDFORM.

*--------------------------------------------------------------------*
* TOP_OF_PAGE
*--------------------------------------------------------------------*
FORM top_of_page.
  DATA: lt_header TYPE slis_t_listheader,
        ls_header TYPE slis_listheader.
  
  " Title
  ls_header-typ  = 'H'.
  ls_header-info = |Finance Open Items Report|.
  APPEND ls_header TO lt_header.
  CLEAR ls_header.
  
  " Company Code
  ls_header-typ  = 'S'.
  ls_header-key  = 'Company Code:'.
  ls_header-info = p_bukrs.
  APPEND ls_header TO lt_header.
  CLEAR ls_header.
  
  " Date Range
  IF s_budat[] IS NOT INITIAL.
    ls_header-typ  = 'S'.
    ls_header-key  = 'Posting Date:'.
    LOOP AT s_budat INTO DATA(ls_budat).
      ls_header-info = |{ ls_budat-low } - { ls_budat-high }|.
      EXIT.
    ENDLOOP.
    APPEND ls_header TO lt_header.
    CLEAR ls_header.
  ENDIF.
  
  " Run Date
  ls_header-typ  = 'S'.
  ls_header-key  = 'Run Date:'.
  ls_header-info = |{ sy-datum DATE = USER } { sy-uzeit TIME = USER }|.
  APPEND ls_header TO lt_header.
  
  CALL FUNCTION 'REUSE_ALV_COMMENTARY_WRITE'
    EXPORTING
      it_list_commentary = lt_header.
ENDFORM.

*--------------------------------------------------------------------*
* USER_COMMAND
*--------------------------------------------------------------------*
FORM user_command USING r_ucomm LIKE sy-ucomm
                        rs_selfield TYPE slis_selfield.
  
  CASE r_ucomm.
    WHEN '&IC1'. " Double click
      IF rs_selfield-fieldname = 'BELNR'.
        " Display document
        READ TABLE gt_open_items INTO DATA(ls_item) INDEX rs_selfield-tabindex.
        IF sy-subrc = 0.
          SET PARAMETER ID 'BLN' FIELD ls_item-belnr.
          SET PARAMETER ID 'BUK' FIELD ls_item-bukrs.
          SET PARAMETER ID 'GJR' FIELD ls_item-gjahr.
          CALL TRANSACTION 'FB03' AND SKIP FIRST SCREEN.
        ENDIF.
      ELSEIF rs_selfield-fieldname = 'KUNNR'.
        " Display customer
        READ TABLE gt_open_items INTO ls_item INDEX rs_selfield-tabindex.
        IF sy-subrc = 0.
          SET PARAMETER ID 'KUN' FIELD ls_item-kunnr.
          CALL TRANSACTION 'XD03' AND SKIP FIRST SCREEN.
        ENDIF.
      ENDIF.
  ENDCASE.
ENDFORM.

*--------------------------------------------------------------------*
* Text symbols
*--------------------------------------------------------------------*
* 001 Selection Parameters