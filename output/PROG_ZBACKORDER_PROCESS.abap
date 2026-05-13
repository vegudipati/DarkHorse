*Assumption: Generating complete report with all required steps including error handling, logging, and RFC communication

REPORT zbackorder_process.

TABLES: vbap, mard.

TYPES: BEGIN OF ty_backorder,
         vbeln     TYPE vbap-vbeln,
         posnr     TYPE vbap-posnr,
         matnr     TYPE vbap-matnr,
         werks     TYPE vbap-werks,
         zmeng     TYPE vbap-zmeng,
         kbmeng    TYPE vbap-kbmeng,
         zzbackorder TYPE vbap-zzbackorder,
         zzdelstat TYPE char10,
       END OF ty_backorder,
       tt_backorders TYPE TABLE OF ty_backorder.

TYPES: BEGIN OF ty_log,
         vbeln        TYPE vbeln_va,
         posnr        TYPE posnr_va,
         process_date TYPE dats,
         process_time TYPE tims,
         status       TYPE char10,
         message      TYPE string,
       END OF ty_log,
       tt_log TYPE TABLE OF ty_log.

DATA: lt_backorders TYPE tt_backorders,
      lt_log        TYPE tt_log,
      lv_stock      TYPE mard-labst,
      lv_remaining  TYPE vbap-zmeng,
      lv_delivered  TYPE vbap-zmeng,
      lv_new_status TYPE char10,
      lv_message    TYPE string.

CONSTANTS: lc_open     TYPE char10 VALUE 'OPEN',
           lc_partial  TYPE char10 VALUE 'PARTIAL',
           lc_complete TYPE char10 VALUE 'COMPLETE',
           lc_error    TYPE char10 VALUE 'ERROR'.

SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
PARAMETERS: p_test AS CHECKBOX DEFAULT 'X'.
SELECTION-SCREEN END OF BLOCK b1.

START-OF-SELECTION.
  PERFORM main_processing.

FORM main_processing.
  DATA: lo_log TYPE REF TO if_bali_log.
  
  " Initialize application log
  TRY.
      lo_log = cl_bali_log=>create( 
        iv_object = 'ZBACKORDER'
        iv_subobject = 'PROCESS'
      ).
    CATCH cx_bali_runtime INTO DATA(lx_log).
      MESSAGE lx_log->get_text( ) TYPE 'E'.
      RETURN.
  ENDTRY.

  " Step 1: Get backorder items
  PERFORM get_backorder_items.
  
  IF lines( lt_backorders ) = 0.
    lv_message = |No backorder items found for processing|.
    PERFORM log_message USING lo_log '' '' lc_complete lv_message.
    PERFORM save_log USING lo_log.
    RETURN.
  ENDIF.

  lv_message = |Processing { lines( lt_backorders ) } backorder items|.
  PERFORM log_message USING lo_log '' '' 'INFO' lv_message.

  " Step 2: Process each backorder item
  LOOP AT lt_backorders INTO DATA(ls_backorder).
    PERFORM process_backorder_item USING ls_backorder lo_log.
  ENDLOOP.

  " Step 8: Commit work
  IF p_test = abap_false.
    COMMIT WORK AND WAIT.
    PERFORM log_message USING lo_log '' '' 'INFO' 'Transaction committed successfully'.
  ELSE.
    ROLLBACK WORK.
    PERFORM log_message USING lo_log '' '' 'INFO' 'Test mode - transaction rolled back'.
  ENDIF.

  " Save application log
  PERFORM save_log USING lo_log.
  
  " Step 9: RFC communication for external systems
  PERFORM notify_external_systems.

ENDFORM.

FORM get_backorder_items.
  " Step 1: SELECT with proper WHERE clause and field list
  SELECT vbeln, posnr, matnr, werks, zmeng, kbmeng, zzbackorder, zzdelstat
    FROM vbap
    INTO CORRESPONDING FIELDS OF TABLE @lt_backorders
    WHERE zzbackorder = 'X'
      AND zzdelstat IN ( @lc_open, @lc_partial )
    PACKAGE SIZE 5000.
ENDFORM.

FORM process_backorder_item USING ls_backorder TYPE ty_backorder
                                  lo_log TYPE REF TO if_bali_log.
  
  CLEAR: lv_stock, lv_remaining, lv_delivered, lv_new_status.
  
  " Step 3: Check current stock
  SELECT SINGLE labst
    FROM mard
    INTO @lv_stock
    WHERE matnr = @ls_backorder-matnr
      AND werks = @ls_backorder-werks.

  IF sy-subrc <> 0.
    lv_message = |No stock record found for material { ls_backorder-matnr } plant { ls_backorder-werks }|.
    PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr lc_error lv_message.
    RETURN.
  ENDIF.

  " Calculate remaining quantity
  lv_remaining = ls_backorder-zmeng - ls_backorder-kbmeng.
  
  " Step 4: Check if sufficient stock available
  IF lv_stock >= lv_remaining.
    " Step 5: Create delivery
    lv_delivered = lv_remaining.
    PERFORM create_delivery USING ls_backorder lv_delivered lo_log.
    
    IF lv_delivered > 0.
      " Step 6: Update sales order
      PERFORM update_sales_order USING ls_backorder lv_delivered lo_log.
    ENDIF.
    
  ELSEIF lv_stock > 0.
    " Partial delivery possible
    lv_delivered = lv_stock.
    PERFORM create_delivery USING ls_backorder lv_delivered lo_log.
    
    IF lv_delivered > 0.
      " Step 6: Update sales order
      PERFORM update_sales_order USING ls_backorder lv_delivered lo_log.
    ENDIF.
    
  ELSE.
    lv_message = |No stock available for material { ls_backorder-matnr } plant { ls_backorder-werks }|.
    PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr 'INFO' lv_message.
  ENDIF.

  " Step 7: Log processing status
  PERFORM log_to_custom_table USING ls_backorder lv_delivered.

ENDFORM.

FORM create_delivery USING ls_backorder TYPE ty_backorder
                           iv_quantity TYPE vbap-zmeng
                           lo_log TYPE REF TO if_bali_log.
  
  DATA: ls_header_data TYPE bapiobdlvhdrchg,
        lt_header_control TYPE TABLE OF bapiobdlvhdrctrlchg,
        lt_item_data TYPE TABLE OF bapiobdlvitemchg,
        lt_item_control TYPE TABLE OF bapiobdlvitemctrlchg,
        lt_return TYPE TABLE OF bapiret2.

  " Step 5: Call BAPI for delivery creation
  TRY.
      " Prepare BAPI parameters
      ls_header_data-doc_date = sy-datum.
      ls_header_data-bill_date = sy-datum.
      
      APPEND VALUE #( vbeln_vl = ls_backorder-vbeln
                      posnr_vl = ls_backorder-posnr
                      dlv_qty = iv_quantity ) TO lt_item_data.
      
      APPEND VALUE #( vbeln_vl = ls_backorder-vbeln
                      posnr_vl = ls_backorder-posnr
                      chg_delqty = 'X' ) TO lt_item_control.

      CALL FUNCTION 'BAPI_DELIVERYPROCESSING_EXEC'
        EXPORTING
          headerdata    = ls_header_data
        TABLES
          headercontrol = lt_header_control
          itemdata      = lt_item_data
          itemcontrol   = lt_item_control
          return        = lt_return.

      " Check BAPI return messages
      READ TABLE lt_return INTO DATA(ls_return) WITH KEY type = 'E'.
      IF sy-subrc = 0.
        lv_message = |Delivery creation failed: { ls_return-message }|.
        PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr lc_error lv_message.
        CLEAR: lv_delivered.
      ELSE.
        lv_message = |Delivery created successfully for quantity { iv_quantity }|.
        PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr 'SUCCESS' lv_message.
        lv_delivered = iv_quantity.
      ENDIF.

    CATCH cx_root INTO DATA(lx_exception).
      lv_message = |Exception during delivery creation: { lx_exception->get_text( ) }|.
      PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr lc_error lv_message.
      CLEAR: lv_delivered.
  ENDTRY.

ENDFORM.

FORM update_sales_order USING ls_backorder TYPE ty_backorder
                              iv_delivered TYPE vbap-zmeng
                              lo_log TYPE REF TO if_bali_log.
  
  DATA: lv_new_kbmeng TYPE vbap-kbmeng.
  
  " Calculate new confirmed quantity
  lv_new_kbmeng = ls_backorder-kbmeng + iv_delivered.
  
  " Determine new delivery status
  IF lv_new_kbmeng >= ls_backorder-zmeng.
    lv_new_status = lc_complete.
  ELSE.
    lv_new_status = lc_partial.
  ENDIF.

  " Step 6: Update sales order item
  IF p_test = abap_false.
    UPDATE vbap 
    SET zzdelstat = @lv_new_status,
        kbmeng = @lv_new_kbmeng
    WHERE vbeln = @ls_backorder-vbeln
      AND posnr = @ls_backorder-posnr.

    IF sy-subrc = 0.
      lv_message = |Sales order updated: status={ lv_new_status }, confirmed qty={ lv_new_kbmeng }|.
      PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr 'SUCCESS' lv_message.
    ELSE.
      lv_message = |Failed to update sales order item|.
      PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr lc_error lv_message.
    ENDIF.
  ELSE.
    lv_message = |Test mode: Would update status={ lv_new_status }, confirmed qty={ lv_new_kbmeng }|.
    PERFORM log_message USING lo_log ls_backorder-vbeln ls_backorder-posnr 'INFO' lv_message.
  ENDIF.

ENDFORM.

FORM log_to_custom_table USING ls_backorder TYPE ty_backorder
                               iv_delivered TYPE vbap-zmeng.
  
  DATA: ls_log_entry TYPE ty_log.
  
  " Step 7: Prepare log entry
  ls_log_entry-vbeln = ls_backorder-vbeln.
  ls_log_entry-posnr = ls_backorder-posnr.
  ls_log_entry-process_date = sy-datum.
  ls_log_entry-process_time = sy-uzeit.
  
  IF iv_delivered > 0.
    ls_log_entry-status = 'SUCCESS'.
    ls_log_entry-message = |Processed quantity: { iv_delivered }|.
  ELSE.
    ls_log_entry-status = 'NO_ACTION'.
    ls_log_entry-message = |No delivery created - insufficient stock|.
  ENDIF.
  
  APPEND ls_log_entry TO lt_log.
  
  " Insert into custom log table
  IF p_test = abap_false.
    INSERT zbackorder_log FROM @ls_log_entry.
    IF sy-subrc <> 0.
      MESSAGE |Failed to insert log entry for { ls_backorder-vbeln }/{ ls_backorder-posnr }| TYPE 'W'.
    ENDIF.
  ENDIF.

ENDFORM.

FORM log_message USING lo_log TYPE REF TO if_bali_log
                       iv_vbeln TYPE vbeln_va
                       iv_posnr TYPE posnr_va
                       iv_severity TYPE char10
                       iv_message TYPE string.
  
  DATA: lo_msg TYPE REF TO if_bali_message.
  
  TRY.
      " Create message object
      lo_msg = cl_bali_message_setter=>create_from_string(
        iv_text = |{ iv_vbeln }/{ iv_posnr }: { iv_message }|
        iv_severity = SWITCH #( iv_severity 
                               WHEN 'ERROR' THEN if_bali_constants=>c_severity_error
                               WHEN 'SUCCESS' THEN if_bali_constants=>c_severity_information
                               ELSE if_bali_constants=>c_severity_information )
      ).
      
      " Add message to log
      lo_log->add_item( lo_msg ).
      
    CATCH cx_bali_runtime.
      " Fallback to system message
      MESSAGE iv_message TYPE 'I'.
  ENDTRY.

ENDFORM.

FORM save_log USING lo_log TYPE REF TO if_bali_log.
  
  TRY.
      DATA(lo_db_writer) = cl_bali_log_db=>get_instance( ).
      lo_db_writer->save_log( lo_log ).
    CATCH cx_bali_runtime.
      MESSAGE 'Failed to save application log' TYPE 'W'.
  ENDTRY.

ENDFORM.

FORM notify_external_systems.
  
  DATA: lo_rfc_dest TYPE REF TO cl_rfc_dest.
  
  " Step 9: RFC communication for external notifications
  TRY.
      lo_rfc_dest = NEW cl_rfc_dest( ).
      
      " Call RFC function for external system notification
      CALL FUNCTION 'Z_BACKORDER_NOTIFY' DESTINATION 'RFC_DEST'
        EXPORTING
          iv_process_date = sy-datum
          iv_process_time = sy-uzeit
          iv_records_processed = lines( lt_backorders )
        TABLES
          it_log_entries = lt_log
        EXCEPTIONS
          communication_failure = 1
          system_failure = 2
          OTHERS = 3.
      
      IF sy-subrc = 0.
        MESSAGE |External systems notified successfully| TYPE 'S'.
      ELSE.
        MESSAGE |Failed to notify external systems: RC={ sy-subrc }| TYPE 'W'.
      ENDIF.
      
    CATCH cx_root INTO DATA(lx_rfc).
      MESSAGE |RFC notification error: { lx_rfc->get_text( ) }| TYPE 'W'.
  ENDTRY.

ENDFORM.