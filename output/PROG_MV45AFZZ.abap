*Assumption: Implementing MV45AFZZ as user exit include with USEREXIT_ATP_QUANTITY form routine for ATP check interception

REPORT mv45afzz.

*----------------------------------------------------------------------*
* User Exit Enhancement for ATP Check Interception in Sales Order Processing
* Technical Name: MV45AFZZ
* Enhancement Point: USEREXIT_ATP_QUANTITY
* Purpose: Automatic backorder creation when ATP check reveals insufficient inventory
*----------------------------------------------------------------------*

TABLES: vbap, mard.

FORM userexit_atp_quantity.
  
  DATA: lv_available TYPE mard-labst,
        lv_current_stock TYPE mard-labst,
        lo_backorder_mgr TYPE REF TO zcl_backorder_manager,
        lv_backorder_id TYPE string,
        lv_message TYPE string.

* Step 2: Check current available stock
  SELECT SINGLE labst
    FROM mard
    WHERE matnr = @xvbap-matnr
      AND werks = @xvbap-werks
    INTO @lv_available.

  IF sy-subrc <> 0.
    lv_available = 0.
  ENDIF.

* Step 3: Compare requested quantity with available stock
  IF xvbap-zmeng > lv_available.
    
    TRY.
        " Create backorder manager instance
        lo_backorder_mgr = NEW zcl_backorder_manager( ).
        
        " Step 3: Create backorder entry
        DATA(ls_backorder_params) = VALUE zcl_backorder_manager=>ty_backorder_params(
          sales_order = xvbap-vbeln
          line_item = xvbap-posnr
          material = xvbap-matnr
          plant = xvbap-werks
          requested_qty = xvbap-zmeng
          available_qty = lv_available
          shortage_qty = xvbap-zmeng - lv_available
        ).
        
        lo_backorder_mgr->create_backorder( 
          EXPORTING 
            is_params = ls_backorder_params
          IMPORTING 
            ev_backorder_id = lv_backorder_id
        ).
        
        " Step 4: Set backorder flags
        xvbap-zzbackorder = 'X'.
        xvbap-zzdelstat = 'OPEN'.
        
        " Step 6: Update confirmed quantity to available stock
        xvbap-kwmeng = lv_available.
        
        " Step 8: Set delivery block if no stock available
        IF lv_available = 0.
          xvbap-lifsk = 'Z1'.
        ENDIF.
        
        " Step 7: Log backorder creation
        CALL FUNCTION 'Z_BACKORDER_LOG_WRITE'
          EXPORTING
            iv_sales_order = xvbap-vbeln
            iv_line_item = xvbap-posnr
            iv_material = xvbap-matnr
            iv_plant = xvbap-werks
            iv_backorder_id = lv_backorder_id
            iv_requested_qty = xvbap-zmeng
            iv_available_qty = lv_available
            iv_shortage_qty = xvbap-zmeng - lv_available
            iv_action = 'CREATE'
          EXCEPTIONS
            error_writing_log = 1
            OTHERS = 2.
        
        IF sy-subrc <> 0.
          " Log write failed - continue processing but add note
          MESSAGE i002(zbackorder) WITH 'Backorder created but logging failed'.
        ELSE.
          " Step 5: Display success message
          lv_message = |Backorder created for insufficient inventory - Available: { lv_available } of { xvbap-zmeng }|.
          MESSAGE i001(zbackorder) WITH lv_message.
        ENDIF.
        
      CATCH zcx_backorder_exception INTO DATA(lo_exception).
        " Handle backorder creation error
        MESSAGE e003(zbackorder) WITH 'Backorder creation failed:' lo_exception->get_text( ).
        
      CATCH cx_root INTO DATA(lo_root_exception).
        " Handle any other unexpected errors
        MESSAGE e004(zbackorder) WITH 'Unexpected error in ATP check:' lo_root_exception->get_text( ).
        
    ENDTRY.
    
  ELSE.
    " Sufficient stock available - clear any existing backorder flags
    CLEAR: xvbap-zzbackorder, xvbap-zzdelstat, xvbap-lifsk.
    
    " Log successful ATP check if previously backordered
    IF xvbap-zzbackorder = 'X'.
      CALL FUNCTION 'Z_BACKORDER_LOG_WRITE'
        EXPORTING
          iv_sales_order = xvbap-vbeln
          iv_line_item = xvbap-posnr
          iv_material = xvbap-matnr
          iv_plant = xvbap-werks
          iv_requested_qty = xvbap-zmeng
          iv_available_qty = lv_available
          iv_action = 'RESOLVED'
        EXCEPTIONS
          error_writing_log = 1
          OTHERS = 2.
    ENDIF.
    
  ENDIF.

ENDFORM.

*----------------------------------------------------------------------*
* Additional helper form routines for backorder processing
*----------------------------------------------------------------------*

FORM check_material_availability
  USING    iv_material TYPE matnr
           iv_plant TYPE werks_d
  CHANGING cv_available TYPE mard-labst.

  SELECT SINGLE labst
    FROM mard
    WHERE matnr = @iv_material
      AND werks = @iv_plant
    INTO @cv_available.
    
  IF sy-subrc <> 0.
    cv_available = 0.
  ENDIF.

ENDFORM.

FORM update_delivery_schedule
  USING iv_sales_order TYPE vbeln_va
        iv_line_item TYPE posnr_va.

  DATA: lt_schedule TYPE TABLE OF bapischdl,
        ls_schedule TYPE bapischdl,
        lt_return TYPE TABLE OF bapiret2.

  " Prepare schedule update for backorder items
  ls_schedule-itm_number = iv_line_item.
  ls_schedule-sched_line = '0001'.
  ls_schedule-req_date = sy-datum + 30.  " Default 30 days future delivery
  APPEND ls_schedule TO lt_schedule.

  " Update delivery schedule via BAPI
  CALL FUNCTION 'BAPI_SALESORDER_CHANGE'
    EXPORTING
      salesdocument = iv_sales_order
    TABLES
      order_schedule_in = lt_schedule
      return = lt_return.

  " Check for errors
  READ TABLE lt_return TRANSPORTING NO FIELDS WITH KEY type = 'E'.
  IF sy-subrc = 0.
    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
  ELSE.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = 'X'.
  ENDIF.

ENDFORM.