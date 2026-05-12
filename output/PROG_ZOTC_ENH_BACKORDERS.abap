*Assumption: Implementing as complete report program with RFC processing and ALV framework as specified

REPORT ZOTC_ENH_BACKORDERS.

*----------------------------------------------------------------------*
* Types and Structures
*----------------------------------------------------------------------*
TYPES: BEGIN OF ty_sales_data,
         vbeln TYPE vbeln_va,
         posnr TYPE posnr_va,
         matnr TYPE matnr,
         kwmeng TYPE kwmeng,
         werks TYPE werks_d,
         vkorg TYPE vkorg,
         erdat TYPE erdat,
         gbstk TYPE gbstk,
         lfimg TYPE lfimg,
       END OF ty_sales_data.

TYPES: BEGIN OF ty_output,
         backorder_num TYPE char20,
         vbeln TYPE vbeln_va,
         posnr TYPE posnr_va,
         matnr TYPE matnr,
         werks TYPE werks_d,
         outstanding_qty TYPE kwmeng,
         available_stock TYPE labst,
         reserved_stock TYPE kalab,
         aging_days TYPE i,
         row_color TYPE lvc_t_scol,
       END OF ty_output.

TYPES: BEGIN OF ty_stock,
         matnr TYPE matnr,
         werks TYPE werks_d,
         labst TYPE labst,
         kalab TYPE kalab,
       END OF ty_stock.

*----------------------------------------------------------------------*
* Selection Screen
*----------------------------------------------------------------------*
SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
SELECT-OPTIONS: s_vkorg FOR vbak-vkorg OBLIGATORY,
                s_werks FOR vbap-werks,
                s_erdat FOR vbak-erdat.
PARAMETERS: p_dest TYPE rfcdest.
SELECTION-SCREEN END OF BLOCK b1.

*----------------------------------------------------------------------*
* Global Variables
*----------------------------------------------------------------------*
DATA: gt_sales_data TYPE TABLE OF ty_sales_data,
      gt_output TYPE TABLE OF ty_output,
      gt_stock TYPE TABLE OF ty_stock,
      go_alv TYPE REF TO cl_salv_table.

*----------------------------------------------------------------------*
* Event Definitions
*----------------------------------------------------------------------*
CLASS lcl_event_handler DEFINITION FINAL.
  PUBLIC SECTION.
    METHODS: on_double_click FOR EVENT double_click OF cl_salv_events_table
      IMPORTING row column.
ENDCLASS.

CLASS lcl_event_handler IMPLEMENTATION.
  METHOD on_double_click.
    READ TABLE gt_output INTO DATA(ls_output) INDEX row.
    IF sy-subrc = 0.
      SET PARAMETER ID 'AUN' FIELD ls_output-vbeln.
      CALL TRANSACTION 'VA03' AND SKIP FIRST SCREEN.
    ENDIF.
  ENDMETHOD.
ENDCLASS.

*----------------------------------------------------------------------*
* INITIALIZATION
*----------------------------------------------------------------------*
INITIALIZATION.
  " Step 1: Set default values using sy-datum for date ranges
  s_erdat-low = sy-datum - 90.
  s_erdat-high = sy-datum.
  s_erdat-sign = 'I'.
  s_erdat-option = 'BT'.
  APPEND s_erdat.
  
  p_dest = 'NONE'.

*----------------------------------------------------------------------*
* AT SELECTION-SCREEN
*----------------------------------------------------------------------*
AT SELECTION-SCREEN.
  " Step 2: Validate input parameters using AUTHORITY-CHECK for V_VBAK_VKO
  LOOP AT s_vkorg.
    AUTHORITY-CHECK OBJECT 'V_VBAK_VKO'
      ID 'VKORG' FIELD s_vkorg-low
      ID 'ACTVT' FIELD '03'.
    IF sy-subrc <> 0.
      MESSAGE e001(zotc) WITH 'No authorization for sales organization' s_vkorg-low.
    ENDIF.
  ENDLOOP.

*----------------------------------------------------------------------*
* START-OF-SELECTION
*----------------------------------------------------------------------*
START-OF-SELECTION.
  " Step 3: Execute main processing routine
  IF p_dest IS NOT INITIAL AND p_dest <> 'NONE'.
    CALL FUNCTION 'Z_OTC_PROCESS_BACKORDERS' DESTINATION p_dest
      TABLES
        it_vkorg = s_vkorg[]
        it_werks = s_werks[]
        it_erdat = s_erdat[]
      EXCEPTIONS
        system_failure = 1
        communication_failure = 2
        OTHERS = 3.
    IF sy-subrc <> 0.
      MESSAGE i002(zotc) WITH 'RFC processing failed, executing locally'.
      PERFORM main_processing.
    ENDIF.
  ELSE.
    PERFORM main_processing.
  ENDIF.

*----------------------------------------------------------------------*
* Forms
*----------------------------------------------------------------------*
FORM main_processing.
  PERFORM get_sales_data.
  PERFORM calculate_outstanding_quantities.
  PERFORM get_stock_data.
  PERFORM create_output_table.
  PERFORM display_alv.
ENDFORM.

FORM get_sales_data.
  " Step 4: SELECT with INNER JOIN and WHERE conditions
  SELECT vbap~vbeln,
         vbap~posnr,
         vbap~matnr,
         vbap~kwmeng,
         vbap~werks,
         vbak~vkorg,
         vbak~erdat,
         vbup~gbstk,
         lips~lfimg
    FROM vbap
    INNER JOIN vbak ON vbap~vbeln = vbak~vbeln
    INNER JOIN vbup ON vbap~vbeln = vbup~vbeln AND vbap~posnr = vbup~posnr
    LEFT OUTER JOIN lips ON vbap~vbeln = lips~vgbel AND vbap~posnr = lips~vgpos
    INTO TABLE @gt_sales_data
    WHERE vbak~vkorg IN @s_vkorg
      AND vbap~werks IN @s_werks
      AND vbak~erdat IN @s_erdat
      AND vbup~gbstk IN ('A', 'B')
      AND vbak~vbtyp = 'C'.
ENDFORM.

FORM calculate_outstanding_quantities.
  " Step 5: Loop and calculate outstanding quantities
  DATA: lt_temp TYPE TABLE OF ty_sales_data.
  
  LOOP AT gt_sales_data INTO DATA(ls_sales) GROUP BY ( vbeln = ls_sales-vbeln posnr = ls_sales-posnr ).
    DATA(lv_total_delivered) = REDUCE kwmeng( INIT sum = 0 
                                              FOR wa IN GROUP ls_sales 
                                              NEXT sum = sum + wa-lfimg ).
    
    READ TABLE gt_sales_data INTO DATA(ls_first) INDEX GROUP ls_sales-tabix.
    ls_first-lfimg = lv_total_delivered.
    APPEND ls_first TO lt_temp.
  ENDLOOP.
  
  gt_sales_data = lt_temp.
  
  DELETE gt_sales_data WHERE ( kwmeng - lfimg ) <= 0.
ENDFORM.

FORM get_stock_data.
  " Step 7: SELECT stock availability data
  IF gt_sales_data IS NOT INITIAL.
    SELECT DISTINCT matnr, werks
      FROM @gt_sales_data AS sales
      INTO TABLE @DATA(lt_mat_plant).
      
    SELECT mard~matnr,
           mard~werks,
           mard~labst,
           mska~kalab
      FROM mard
      LEFT OUTER JOIN mska ON mard~matnr = mska~matnr AND mard~werks = mska~werks
      INTO CORRESPONDING FIELDS OF TABLE @gt_stock
      FOR ALL ENTRIES IN @lt_mat_plant
      WHERE mard~matnr = @lt_mat_plant-matnr
        AND mard~werks = @lt_mat_plant-werks
        AND mard~lgort = '0001'.
  ENDIF.
ENDFORM.

FORM create_output_table.
  " Step 5 & 6: Create output with backorder numbering and aging
  LOOP AT gt_sales_data INTO DATA(ls_sales).
    DATA(ls_output) = CORRESPONDING ty_output( ls_sales ).
    
    " Step 6: Get backorder number
    CALL FUNCTION 'NUMBER_GET_NEXT'
      EXPORTING
        nr_range_nr = '01'
        object = 'ZNUMBO'
      IMPORTING
        number = ls_output-backorder_num
      EXCEPTIONS
        interval_not_found = 1
        number_range_not_intern = 2
        object_not_found = 3
        quantity_is_0 = 4
        quantity_is_not_1 = 5
        interval_overflow = 6
        buffer_overflow = 7
        OTHERS = 8.
    
    " Calculate outstanding quantity
    ls_output-outstanding_qty = ls_sales-kwmeng - ls_sales-lfimg.
    
    " Get stock data
    READ TABLE gt_stock INTO DATA(ls_stock) WITH KEY matnr = ls_sales-matnr
                                                     werks = ls_sales-werks.
    IF sy-subrc = 0.
      ls_output-available_stock = ls_stock-labst.
      ls_output-reserved_stock = ls_stock-kalab.
    ENDIF.
    
    " Step 8: Calculate aging and apply color coding
    ls_output-aging_days = sy-datum - ls_sales-erdat.
    
    " Color coding logic
    DATA(ls_color) = VALUE lvc_s_scol( ).
    ls_color-fname = 'AGING_DAYS'.
    IF ls_output-aging_days > 60.
      ls_color-color-col = 6.  " Red
    ELSEIF ls_output-aging_days > 30.
      ls_color-color-col = 3.  " Yellow  
    ELSE.
      ls_color-color-col = 5.  " Green
    ENDIF.
    ls_color-color-int = 1.
    APPEND ls_color TO ls_output-row_color.
    
    APPEND ls_output TO gt_output.
  ENDLOOP.
ENDFORM.

FORM display_alv.
  " Step 9: Create ALV instance
  TRY.
      cl_salv_table=>factory(
        IMPORTING
          r_salv_table = go_alv
        CHANGING
          t_table = gt_output ).
          
    " Step 10: Register event handler for double-click drill-down
    DATA(lo_events) = go_alv->get_event( ).
    DATA(lo_handler) = NEW lcl_event_handler( ).
    SET HANDLER lo_handler->on_double_click FOR lo_events.
    
    " Configure ALV columns
    DATA(lo_columns) = go_alv->get_columns( ).
    lo_columns->set_optimize( ).
    
    " Set column texts
    lo_columns->get_column( 'BACKORDER_NUM' )->set_long_text( 'Backorder Number' ).
    lo_columns->get_column( 'VBELN' )->set_long_text( 'Sales Order' ).
    lo_columns->get_column( 'OUTSTANDING_QTY' )->set_long_text( 'Outstanding Qty' ).
    lo_columns->get_column( 'AVAILABLE_STOCK' )->set_long_text( 'Available Stock' ).
    lo_columns->get_column( 'AGING_DAYS' )->set_long_text( 'Aging Days' ).
    
    " Enable color column
    TRY.
        lo_columns->set_color_column( 'ROW_COLOR' ).
      CATCH cx_salv_data_error.
        " Color column setting failed - continue without colors
    ENDTRY.
    
    " Display ALV
    go_alv->display( ).
    
  CATCH cx_salv_msg INTO DATA(lo_salv_error).
    MESSAGE lo_salv_error->get_text( ) TYPE 'E'.
  ENDTRY.
ENDFORM.