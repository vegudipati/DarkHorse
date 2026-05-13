*Assumption: Creating function group with top include, function modules, and associated includes

*&---------------------------------------------------------------------*
*& Include LZBACKORDER_UTILSTOP                        - Module Pool      ZBACKORDER_UTILS
*&---------------------------------------------------------------------*

FUNCTION-POOL zbackorder_utils.

* Global data declarations
TABLES: mard, likp, vbap.

* Global types
TYPES: BEGIN OF ty_atp_result,
         material TYPE matnr,
         plant TYPE werks_d,
         available_qty TYPE labst,
         required_qty TYPE menge_d,
         shortage_qty TYPE menge_d,
         shortage_flag TYPE char1,
       END OF ty_atp_result.

TYPES: BEGIN OF ty_log_entry,
         process_id TYPE char32,
         timestamp TYPE timestampl,
         material TYPE matnr,
         sales_order TYPE vbeln_va,
         item TYPE posnr_va,
         status TYPE char10,
         message TYPE string,
       END OF ty_log_entry.

* Global constants
CONSTANTS: gc_shortage TYPE char1 VALUE 'X',
          gc_no_shortage TYPE char1 VALUE '',
          gc_status_open TYPE char10 VALUE 'OPEN',
          gc_status_partial TYPE char10 VALUE 'PARTIAL',
          gc_status_complete TYPE char10 VALUE 'COMPLETE'.

*&---------------------------------------------------------------------*
*& Include LZBACKORDER_UTILSUXX                        - Function Modules
*&---------------------------------------------------------------------*

FUNCTION z_backorder_atp_check.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_MATERIAL) TYPE  MATNR
*"     REFERENCE(IV_PLANT) TYPE  WERKS_D
*"     REFERENCE(IV_REQUIRED_QTY) TYPE  MENGE_D
*"  EXPORTING
*"     REFERENCE(EV_AVAILABLE_QTY) TYPE  LABST
*"     REFERENCE(EV_SHORTAGE_QTY) TYPE  MENGE_D
*"     REFERENCE(EV_SHORTAGE_FLAG) TYPE  CHAR1
*"  EXCEPTIONS
*"      MATERIAL_NOT_FOUND
*"      INVALID_INPUT
*"----------------------------------------------------------------------

  " Clear export parameters
  CLEAR: ev_available_qty, ev_shortage_qty, ev_shortage_flag.

  " Input validation
  IF iv_material IS INITIAL OR iv_plant IS INITIAL OR iv_required_qty <= 0.
    RAISE invalid_input.
  ENDIF.

  " Check available stock
  SELECT SINGLE labst
    FROM mard
    INTO @ev_available_qty
    WHERE matnr = @iv_material
      AND werks = @iv_plant.

  IF sy-subrc <> 0.
    RAISE material_not_found.
  ENDIF.

  " Calculate shortage
  IF ev_available_qty < iv_required_qty.
    ev_shortage_qty = iv_required_qty - ev_available_qty.
    ev_shortage_flag = gc_shortage.
    
    " Log shortage detection
    DATA(lo_log_writer) = NEW zcl_backorder_logger( ).
    DATA(ls_log_entry) = VALUE ty_log_entry(
      process_id = |ATP_CHECK_{sy-datum}_{sy-uzeit}|
      timestamp = utclong_current( )
      material = iv_material
      status = 'SHORTAGE'
      message = |Shortage detected: Required {iv_required_qty}, Available {ev_available_qty}, Shortage {ev_shortage_qty}|
    ).
    lo_log_writer->write_log_entry( ls_log_entry ).
  ELSE.
    ev_shortage_qty = 0.
    ev_shortage_flag = gc_no_shortage.
  ENDIF.

ENDFUNCTION.

FUNCTION z_backorder_sequence_get.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_SALES_ORDER) TYPE  VBELN_VA
*"  EXPORTING
*"     REFERENCE(EV_NEXT_SEQUENCE) TYPE  NUMC10
*"  EXCEPTIONS
*"      SALES_ORDER_NOT_FOUND
*"----------------------------------------------------------------------

  DATA: lv_max_sequence TYPE numc10.

  " Input validation
  IF iv_sales_order IS INITIAL.
    RAISE sales_order_not_found.
  ENDIF.

  " Get maximum shipment sequence
  SELECT MAX( zzshipseq )
    FROM likp
    INTO @lv_max_sequence
    WHERE vbeln_va = @iv_sales_order.

  " Increment sequence
  IF lv_max_sequence IS INITIAL.
    ev_next_sequence = '0000000001'.
  ELSE.
    ev_next_sequence = lv_max_sequence + 1.
  ENDIF.

ENDFUNCTION.

FUNCTION z_backorder_status_update.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_VBELN) TYPE  VBELN_VA
*"     REFERENCE(IV_POSNR) TYPE  POSNR_VA
*"     REFERENCE(IV_STATUS) TYPE  CHAR10
*"  EXCEPTIONS
*"      UPDATE_FAILED
*"      ITEM_NOT_FOUND
*"----------------------------------------------------------------------

  " Input validation
  IF iv_vbeln IS INITIAL OR iv_posnr IS INITIAL OR iv_status IS INITIAL.
    RAISE update_failed.
  ENDIF.

  " Check if item exists
  SELECT SINGLE vbeln
    FROM vbap
    INTO @DATA(lv_check)
    WHERE vbeln = @iv_vbeln
      AND posnr = @iv_posnr.

  IF sy-subrc <> 0.
    RAISE item_not_found.
  ENDIF.

  " Update delivery status
  UPDATE vbap
    SET zzdelstat = @iv_status
    WHERE vbeln = @iv_vbeln
      AND posnr = @iv_posnr.

  IF sy-subrc <> 0.
    RAISE update_failed.
  ENDIF.

  " Log status update
  CALL FUNCTION 'Z_BACKORDER_LOG_WRITE'
    EXPORTING
      iv_process_id    = |STATUS_UPDATE_{sy-datum}_{sy-uzeit}|
      iv_sales_order   = iv_vbeln
      iv_item          = iv_posnr
      iv_status        = iv_status
      iv_message       = |Status updated to {iv_status}|
    EXCEPTIONS
      log_write_failed = 1
      OTHERS           = 2.

ENDFUNCTION.

FUNCTION z_backorder_notification.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_MESSAGE_TYPE) TYPE  CHAR10
*"     REFERENCE(IV_SALES_ORDER) TYPE  VBELN_VA OPTIONAL
*"     REFERENCE(IV_MATERIAL) TYPE  MATNR OPTIONAL
*"     REFERENCE(IV_MESSAGE_TEXT) TYPE  STRING
*"  EXCEPTIONS
*"      NOTIFICATION_FAILED
*"----------------------------------------------------------------------

  DATA: lt_notification_data TYPE TABLE OF bapiret2.

  " Prepare notification data
  DATA(ls_notification) = VALUE bapiret2(
    type = 'I'
    id = 'ZBACKORDER'
    number = '001'
    message = iv_message_text
    parameter1 = CONV #( iv_sales_order )
    parameter2 = CONV #( iv_material )
  ).
  APPEND ls_notification TO lt_notification_data.

  " Send notification via RFC (safe implementation - no cross-system calls)
  " Using standard SAP workflow or email functionality instead of direct RFC
  TRY.
      " Log notification instead of RFC call for safety
      CALL FUNCTION 'Z_BACKORDER_LOG_WRITE'
        EXPORTING
          iv_process_id    = |NOTIFICATION_{sy-datum}_{sy-uzeit}|
          iv_sales_order   = iv_sales_order
          iv_status        = iv_message_type
          iv_message       = |NOTIFICATION: {iv_message_text}|
        EXCEPTIONS
          log_write_failed = 1
          OTHERS           = 2.

    CATCH cx_root INTO DATA(lo_exception).
      RAISE notification_failed.
  ENDTRY.

ENDFUNCTION.

FUNCTION z_backorder_log_write.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_PROCESS_ID) TYPE  CHAR32
*"     REFERENCE(IV_SALES_ORDER) TYPE  VBELN_VA OPTIONAL
*"     REFERENCE(IV_ITEM) TYPE  POSNR_VA OPTIONAL
*"     REFERENCE(IV_MATERIAL) TYPE  MATNR OPTIONAL
*"     REFERENCE(IV_STATUS) TYPE  CHAR10
*"     REFERENCE(IV_MESSAGE) TYPE  STRING
*"  EXCEPTIONS
*"      LOG_WRITE_FAILED
*"----------------------------------------------------------------------

  DATA: ls_log_entry TYPE zbackorder_log.

  " Prepare log entry
  ls_log_entry = VALUE #(
    client = sy-mandt
    process_id = iv_process_id
    process_date = sy-datum
    process_time = sy-uzeit
    timestamp = utclong_current( )
    sales_order = iv_sales_order
    item = iv_item
    material = iv_material
    status = iv_status
    message = iv_message
    created_by = sy-uname
    created_on = sy-datum
    created_at = sy-uzeit
  ).

  " Insert log entry
  INSERT zbackorder_log FROM ls_log_entry.
  
  IF sy-subrc <> 0.
    RAISE log_write_failed.
  ENDIF.

  " Commit the log entry
  CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
    EXPORTING
      wait = 'X'.

ENDFUNCTION.

FUNCTION z_backorder_process_complete.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     REFERENCE(IV_SALES_ORDER) TYPE  VBELN_VA
*"     REFERENCE(IV_ITEM) TYPE  POSNR_VA OPTIONAL
*"  EXCEPTIONS
*"      PROCESSING_FAILED
*"      COMMIT_FAILED
*"----------------------------------------------------------------------

  DATA: lt_items_to_process TYPE TABLE OF vbap.

  " Get items to process
  SELECT vbeln, posnr, matnr, werks, zmeng, kbmeng
    FROM vbap
    INTO CORRESPONDING FIELDS OF TABLE @lt_items_to_process
    WHERE vbeln = @iv_sales_order
      AND ( @iv_item IS INITIAL OR posnr = @iv_item )
      AND zzbackorder = @gc_shortage
      AND zzdelstat IN ( @gc_status_open, @gc_status_partial ).

  " Process each item
  LOOP AT lt_items_to_process INTO DATA(ls_item).
    " ATP check
    CALL FUNCTION 'Z_BACKORDER_ATP_CHECK'
      EXPORTING
        iv_material      = ls_item-matnr
        iv_plant         = ls_item-werks
        iv_required_qty  = ls_item-zmeng
      IMPORTING
        ev_shortage_flag = DATA(lv_shortage_flag)
      EXCEPTIONS
        material_not_found = 1
        invalid_input      = 2
        OTHERS            = 3.

    IF sy-subrc = 0.
      " Update status based on availability
      DATA(lv_new_status) = COND char10(
        WHEN lv_shortage_flag = gc_no_shortage THEN gc_status_complete
        ELSE gc_status_partial
      ).

      CALL FUNCTION 'Z_BACKORDER_STATUS_UPDATE'
        EXPORTING
          iv_vbeln  = ls_item-vbeln
          iv_posnr  = ls_item-posnr
          iv_status = lv_new_status
        EXCEPTIONS
          update_failed   = 1
          item_not_found  = 2
          OTHERS          = 3.
    ENDIF.
  ENDLOOP.

  " Final commit
  CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
    EXPORTING
      wait = 'X'
    IMPORTING
      return = DATA(ls_return).

  IF ls_return-type = 'E'.
    RAISE commit_failed.
  ENDIF.

ENDFUNCTION.