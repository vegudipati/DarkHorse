REPORT ZFIN_OPEN_ITEMS.

*----------------------------------------------------------------------*
* Finance Open Items Report
*----------------------------------------------------------------------*

TABLES: bsid.

*----------------------------------------------------------------------*
* Selection Screen
*----------------------------------------------------------------------*
SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
PARAMETERS: p_bukrs TYPE bukrs OBLIGATORY.
SELECT-OPTIONS: s_budat FOR bsid-budat.
SELECTION-SCREEN END OF BLOCK b1.

*----------------------------------------------------------------------*
* Types and Data Declarations
*----------------------------------------------------------------------*
TYPES: BEGIN OF ty_output,
         bukrs TYPE bukrs,
         kunnr TYPE kunnr,
         name1 TYPE name1_gp,
         belnr TYPE belnr_d,
         gjahr TYPE gjahr,
         budat TYPE budat,
         bldat TYPE bldat,
         shkzg TYPE shkzg,
         dmbtr TYPE dmbtr,
         waers TYPE waers,
       END OF ty_output,
       tt_output TYPE TABLE OF ty_output.

DATA: gt_output TYPE tt_output,
      go_alv    TYPE REF TO cl_gui_alv_grid,
      go_container TYPE REF TO cl_gui_docking_container.

*----------------------------------------------------------------------*
* Local Classes
*----------------------------------------------------------------------*
CLASS lcl_data_handler DEFINITION.
  PUBLIC SECTION.
    METHODS: get_open_items
               IMPORTING
                 iv_bukrs        TYPE bukrs
                 it_budat        TYPE STANDARD TABLE
               RETURNING
                 VALUE(rt_output) TYPE tt_output.
ENDCLASS.

CLASS lcl_alv_handler DEFINITION.
  PUBLIC SECTION.
    METHODS: display_report
               IMPORTING
                 it_data TYPE tt_output.
  PRIVATE SECTION.
    METHODS: build_fieldcat
               RETURNING
                 VALUE(rt_fieldcat) TYPE lvc_t_fcat,
             set_layout
               RETURNING
                 VALUE(rs_layout) TYPE lvc_s_layo.
ENDCLASS.

*----------------------------------------------------------------------*
* Event Handling
*----------------------------------------------------------------------*
AT SELECTION-SCREEN.
  PERFORM validate_authority.

START-OF-SELECTION.
  PERFORM main_processing.

*----------------------------------------------------------------------*
* Local Class Implementations
*----------------------------------------------------------------------*
CLASS lcl_data_handler IMPLEMENTATION.
  METHOD get_open_items.
    SELECT b~bukrs,
           b~kunnr,
           k~name1,
           b~belnr,
           b~gjahr,
           b~budat,
           b~bldat,
           b~shkzg,
           b~dmbtr,
           b~waers
      FROM bsid AS b
      LEFT OUTER JOIN kna1 AS k ON b~kunnr = k~kunnr
      INTO CORRESPONDING FIELDS OF TABLE @rt_output
      WHERE b~bukrs = @iv_bukrs
        AND b~ausgl = @space
        AND b~budat IN @it_budat
      ORDER BY b~bukrs, b~kunnr, b~budat.

    IF sy-subrc <> 0.
      MESSAGE i001(z_fin) WITH 'No open items found for selection criteria'.
    ENDIF.
  ENDMETHOD.
ENDCLASS.

CLASS lcl_alv_handler IMPLEMENTATION.
  METHOD display_report.
    DATA: lt_fieldcat TYPE lvc_t_fcat,
          ls_layout   TYPE lvc_s_layo.

    lt_fieldcat = build_fieldcat( ).
    ls_layout = set_layout( ).

    IF go_container IS NOT BOUND.
      go_container = NEW cl_gui_docking_container(
        side = cl_gui_docking_container=>dock_at_bottom
        extension = 2000 ).

      go_alv = NEW cl_gui_alv_grid( i_parent = go_container ).
    ENDIF.

    CALL METHOD go_alv->set_table_for_first_display
      EXPORTING
        is_layout       = ls_layout
        it_fieldcatalog = lt_fieldcat
      CHANGING
        it_outtab       = it_data.
  ENDMETHOD.

  METHOD build_fieldcat.
    DATA: ls_fieldcat TYPE lvc_s_fcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'BUKRS'.
    ls_fieldcat-coltext = 'Company Code'.
    ls_fieldcat-outputlen = 4.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'KUNNR'.
    ls_fieldcat-coltext = 'Customer'.
    ls_fieldcat-outputlen = 10.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'NAME1'.
    ls_fieldcat-coltext = 'Customer Name'.
    ls_fieldcat-outputlen = 35.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'BELNR'.
    ls_fieldcat-coltext = 'Document Number'.
    ls_fieldcat-outputlen = 10.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'GJAHR'.
    ls_fieldcat-coltext = 'Fiscal Year'.
    ls_fieldcat-outputlen = 4.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'BUDAT'.
    ls_fieldcat-coltext = 'Posting Date'.
    ls_fieldcat-outputlen = 10.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'BLDAT'.
    ls_fieldcat-coltext = 'Document Date'.
    ls_fieldcat-outputlen = 10.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'SHKZG'.
    ls_fieldcat-coltext = 'D/C'.
    ls_fieldcat-outputlen = 1.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'DMBTR'.
    ls_fieldcat-coltext = 'Amount'.
    ls_fieldcat-outputlen = 15.
    ls_fieldcat-do_sum = 'X'.
    APPEND ls_fieldcat TO rt_fieldcat.

    CLEAR: ls_fieldcat.
    ls_fieldcat-fieldname = 'WAERS'.
    ls_fieldcat-coltext = 'Currency'.
    ls_fieldcat-outputlen = 5.
    APPEND ls_fieldcat TO rt_fieldcat.
  ENDMETHOD.

  METHOD set_layout.
    rs_layout-zebra = 'X'.
    rs_layout-cwidth_opt = 'X'.
    rs_layout-sel_mode = 'D'.
  ENDMETHOD.
ENDCLASS.

*----------------------------------------------------------------------*
* Subroutines
*----------------------------------------------------------------------*
FORM validate_authority.
  AUTHORITY-CHECK OBJECT 'F_BKPF_BUK'
    ID 'BUKRS' FIELD p_bukrs
    ID 'ACTVT' FIELD '03'.

  IF sy-subrc <> 0.
    MESSAGE e002(z_fin) WITH p_bukrs 'No authorization for company code'.
  ENDIF.

  " Validate company code exists
  SELECT SINGLE bukrs FROM t001 INTO @DATA(lv_bukrs)
    WHERE bukrs = @p_bukrs.

  IF sy-subrc <> 0.
    MESSAGE e003(z_fin) WITH p_bukrs 'Company code does not exist'.
  ENDIF.
ENDFORM.

FORM main_processing.
  DATA: lo_data_handler TYPE REF TO lcl_data_handler,
        lo_alv          TYPE REF TO lcl_alv_handler.

  " Instantiate data handler
  lo_data_handler = NEW #( ).

  " Get open items data
  gt_output = lo_data_handler->get_open_items(
    iv_bukrs = p_bukrs
    it_budat = s_budat[] ).

  IF lines( gt_output ) > 0.
    " Instantiate ALV handler
    lo_alv = NEW #( ).

    " Display report
    lo_alv->display_report( gt_output ).

    " Keep screen active for ALV interaction
    WRITE: / 'Open Items Report displayed in ALV Grid'.
  ELSE.
    WRITE: / 'No open items found for the selected criteria.'.
  ENDIF.
ENDFORM.