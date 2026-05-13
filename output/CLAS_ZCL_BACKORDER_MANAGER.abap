*COMMENT: Generating class RFC_DEST with backorder and delivery processing logic

CLASS zcl_rfc_dest DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    TYPES: BEGIN OF ty_backorder_result,
             material TYPE matnr,
             plant    TYPE werks_d,
             available_qty TYPE labst,
             required_qty  TYPE zmeng,
             shortage     TYPE abap_bool,
           END OF ty_backorder_result,

           BEGIN OF ty_delivery_data,
             sales_order TYPE vbeln_va,
             delivery    TYPE vbeln_vl,
             status      TYPE char10,
           END OF ty_delivery_data.

    DATA: gs_vbap TYPE vbap,
          gv_delivery TYPE vbeln_vl,
          gt_errors TYPE bapiret2_t.

    METHODS: create_backorder
               IMPORTING iv_material TYPE matnr
                         iv_plant    TYPE werks_d
                         iv_quantity TYPE zmeng
               RETURNING VALUE(rs_result) TYPE ty_backorder_result
               RAISING   cx_sy_sql_error,

             process_delivery
               IMPORTING iv_sales_order TYPE vbeln_va
               RETURNING VALUE(rs_delivery) TYPE ty_delivery_data
               RAISING   cx_sy_function_call_error,

             update_shipment_sequence
               IMPORTING iv_delivery TYPE vbeln_vl
               RAISING   cx_sy_sql_error,

             check_completion
               IMPORTING iv_sales_order TYPE vbeln_va
                         iv_position    TYPE posnr_va
               RAISING   cx_sy_sql_error,

             handle_errors
               IMPORTING it_errors TYPE bapiret2_t,

             execute_backorder_process
               IMPORTING iv_sales_order TYPE vbeln_va.

  PRIVATE SECTION.
    CONSTANTS: lc_backorder_flag TYPE char1 VALUE 'X',
               lc_status_open    TYPE char10 VALUE 'OPEN',
               lc_status_complete TYPE char10 VALUE 'COMPLETE',
               lc_status_partial  TYPE char10 VALUE 'PARTIAL'.

ENDCLASS.

CLASS zcl_rfc_dest IMPLEMENTATION.

  METHOD create_backorder.
    DATA: lv_available_qty TYPE labst,
          ls_atp_result    TYPE bapimatavailabi,
          lt_return        TYPE bapiret2_t.

    CLEAR: rs_result, lt_return.
    rs_result-material = iv_material.
    rs_result-plant = iv_plant.
    rs_result-required_qty = iv_quantity.

    TRY.
        " Call custom ATP check function
        CALL FUNCTION 'Z_BACKORDER_ATP_CHECK'
          EXPORTING
            iv_material     = iv_material
            iv_plant        = iv_plant
            iv_req_quantity = iv_quantity
          IMPORTING
            es_atp_result   = ls_atp_result
          TABLES
            et_return       = lt_return
          EXCEPTIONS
            material_not_found = 1
            plant_not_found   = 2
            atp_error        = 3
            OTHERS           = 4.

        IF sy-subrc <> 0.
          MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
            WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4 INTO DATA(lv_message).
          RAISE EXCEPTION TYPE cx_sy_function_call_error
            EXPORTING
              textid = cx_sy_function_call_error=>function_call_failed.
        ENDIF.

        rs_result-available_qty = ls_atp_result-com_qty.

        " Check for stock shortage
        IF ls_atp_result-com_qty < iv_quantity.
          rs_result-shortage = abap_true.

          " Set backorder flags in global structure
          gs_vbap-zzbackorder = lc_backorder_flag.
          gs_vbap-zzdelstat = lc_status_open.

          " Log the backorder creation
          MESSAGE i001(zbackorder) WITH iv_material iv_plant INTO lv_message.

        ELSE.
          rs_result-shortage = abap_false.
        ENDIF.

        " Store any returned messages
        gt_errors = lt_return.

      CATCH cx_sy_sql_error INTO DATA(lx_sql_error).
        MESSAGE e002(zbackorder) WITH lx_sql_error->get_text( ) INTO lv_message.
        RAISE EXCEPTION lx_sql_error.

    ENDTRY.

  ENDMETHOD.

  METHOD process_delivery.
    DATA: ls_delivery_header TYPE bapiobdlvhdrchg,
          lt_delivery_items  TYPE bapiobdlvitemchg_t,
          ls_delivery_item   TYPE bapiobdlvitemchg,
          lt_return         TYPE bapiret2_t,
          lv_delivery_new   TYPE vbeln_vl.

    CLEAR: rs_delivery, lt_return.
    rs_delivery-sales_order = iv_sales_order.

    TRY.
        " Prepare delivery header data
        ls_delivery_header-deliv_numb = space.
        ls_delivery_header-doc_date = sy-datum.
        ls_delivery_header-act_gi_date = sy-datum.

        " Get sales order items for delivery creation
        SELECT vbeln, posnr, matnr, zmeng, kbmeng
          FROM vbap
          INTO TABLE @DATA(lt_vbap_items)
          WHERE vbeln = @iv_sales_order
            AND zzbackorder = @lc_backorder_flag
            AND zzdelstat IN ( @lc_status_open, @lc_status_partial ).

        " Prepare delivery items
        LOOP AT lt_vbap_items INTO DATA(ls_vbap_item).
          ls_delivery_item-deliv_numb = space.
          ls_delivery_item-deliv_item = ls_vbap_item-posnr.
          ls_delivery_item-material = ls_vbap_item-matnr.
          ls_delivery_item-dlv_qty = ls_vbap_item-zmeng.
          ls_delivery_item-dlv_qty_imunit = ls_vbap_item-zmeng.
          APPEND ls_delivery_item TO lt_delivery_items.
          CLEAR ls_delivery_item.
        ENDLOOP.

        " Call delivery processing BAPI
        CALL FUNCTION 'BAPI_DELIVERYPROCESSING_EXEC'
          EXPORTING
            deliveryheaderchangedoc = ls_delivery_header
          IMPORTING
            delivery                = lv_delivery_new
          TABLES
            deliveryitemchangedoc   = lt_delivery_items
            return                  = lt_return.

        " Check for errors
        READ TABLE lt_return TRANSPORTING NO FIELDS WITH KEY type = 'E'.
        IF sy-subrc = 0.
          rs_delivery-status = 'ERROR'.
          gt_errors = lt_return.
          handle_errors( lt_return ).
          RAISE EXCEPTION TYPE cx_sy_function_call_error.
        ENDIF.

        " Successful delivery creation
        IF sy-subrc = 0 AND lv_delivery_new IS NOT INITIAL.
          rs_delivery-delivery = lv_delivery_new.
          rs_delivery-status = 'SUCCESS'.
          gv_delivery = lv_delivery_new.

          " Commit the transaction
          CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
            EXPORTING
              wait = abap_true.

          " Update shipment sequence
          update_shipment_sequence( lv_delivery_new ).

          MESSAGE s003(zbackorder) WITH lv_delivery_new INTO DATA(lv_message).
        ENDIF.

      CATCH cx_sy_function_call_error INTO DATA(lx_function_error).
        rs_delivery-status = 'ERROR'.
        MESSAGE e004(zbackorder) WITH lx_function_error->get_text( ) INTO lv_message.
        RAISE EXCEPTION lx_function_error.

    ENDTRY.

  ENDMETHOD.

  METHOD update_shipment_sequence.
    DATA: lv_max_seq TYPE zzshipseq,
          lv_new_seq TYPE zzshipseq.

    TRY.
        " Get maximum shipment sequence
        SELECT SINGLE MAX( zzshipseq )
          FROM likp
          INTO @lv_max_seq
          WHERE client = @sy-mandt.

        IF sy-subrc <> 0.
          lv_max_seq = 0.
        ENDIF.

        " Calculate new sequence number
        lv_new_seq = lv_max_seq + 1.

        " Update delivery header with new sequence
        UPDATE likp
           SET zzshipseq = @lv_new_seq
         WHERE vbeln = @iv_delivery
           AND client = @sy-mandt.

        IF sy-subrc = 0.
          MESSAGE s005(zbackorder) WITH iv_delivery lv_new_seq INTO DATA(lv_message).
        ELSE.
          MESSAGE e006(zbackorder) WITH iv_delivery INTO lv_message.
          RAISE EXCEPTION TYPE cx_sy_sql_error.
        ENDIF.

      CATCH cx_sy_sql_error INTO DATA(lx_sql_error).
        MESSAGE e007(zbackorder) WITH lx_sql_error->get_text( ) INTO DATA(lv_error_msg).
        RAISE EXCEPTION lx_sql_error.

    ENDTRY.

  ENDMETHOD.

  METHOD check_completion.
    DATA: ls_vbap TYPE vbap.

    TRY.
        " Get current sales order item data
        SELECT SINGLE vbeln, posnr, kbmeng, zmeng, zzdelstat
          FROM vbap
          INTO @ls_vbap
          WHERE vbeln = @iv_sales_order
            AND posnr = @iv_position.

        IF sy-subrc = 0.
          " Check if delivered quantity equals ordered quantity
          IF ls_vbap-kbmeng = ls_vbap-zmeng.
            " Update status to complete
            UPDATE vbap
               SET zzdelstat = @lc_status_complete
             WHERE vbeln = @iv_sales_order
               AND posnr = @iv_position.

            IF sy-subrc = 0.
              MESSAGE s008(zbackorder) WITH iv_sales_order iv_position INTO DATA(lv_message).
            ENDIF.

          ELSEIF ls_vbap-kbmeng > 0 AND ls_vbap-kbmeng < ls_vbap-zmeng.
            " Partial delivery
            UPDATE vbap
               SET zzdelstat = @lc_status_partial
             WHERE vbeln = @iv_sales_order
               AND posnr = @iv_position.

          ENDIF.
        ENDIF.

      CATCH cx_sy_sql_error INTO DATA(lx_sql_error).
        MESSAGE e009(zbackorder) WITH lx_sql_error->get_text( ) INTO DATA(lv_error_msg).
        RAISE EXCEPTION lx_sql_error.

    ENDTRY.

  ENDMETHOD.

  METHOD handle_errors.
    DATA: lt_error_details TYPE bapiret2_t,
          ls_error         TYPE bapiret2,
          lv_error_text    TYPE string.

    " Process each error message
    LOOP AT it_errors INTO ls_error WHERE type CA 'EAX'.
      " Build error message text
      lv_error_text = |{ ls_error-id }-{ ls_error-number }: { ls_error-message }|.

      TRY.
          " Call RFC destination for error logging
          CALL FUNCTION 'RFC_DEST'
            EXPORTING
              error_id      = ls_error-id
              error_number  = ls_error-number
              error_message = lv_error_text
              error_type    = ls_error-type
            EXCEPTIONS
              communication_failure = 1
              system_failure       = 2
              OTHERS              = 3.

          IF sy-subrc <> 0.
            " If RFC fails, log locally
            MESSAGE e010(zbackorder) WITH lv_error_text INTO DATA(lv_message).
          ENDIF.

          " For critical errors, send notification
          IF ls_error-type = 'E' OR ls_error-type = 'A'.
            CALL FUNCTION 'MESSAGE_TYPE_X'
              EXPORTING
                arbgb     = ls_error-id
                msgnr     = ls_error-number
                msgty     = 'X'
                msgv1     = ls_error-message_v1
                msgv2     = ls_error-message_v2
                msgv3     = ls_error-message_v3
                msgv4     = ls_error-message_v4
              EXCEPTIONS
                OTHERS    = 1.
          ENDIF.

        CATCH cx_root INTO DATA(lx_error).
          " Fallback error handling
          MESSAGE e011(zbackorder) WITH lx_error->get_text( ) INTO lv_message.

      ENDTRY.
    ENDLOOP.

    " Store errors in global table for further processing
    APPEND LINES OF it_errors TO gt_errors.

  ENDMETHOD.

  METHOD execute_backorder_process.
    DATA: ls_backorder_result TYPE ty_backorder_result,
          ls_delivery_result  TYPE ty_delivery_data,
          lt_vbap_items      TYPE TABLE OF vbap.

    TRY.
        " Get all backorder items for the sales order
        SELECT vbeln, posnr, matnr, werks, zmeng, kbmeng, zzbackorder, zzdelstat
          FROM vbap
          INTO TABLE @lt_vbap_items
          WHERE vbeln = @iv_sales_order
            AND zzbackorder = @lc_backorder_flag
            AND zzdelstat IN ( @lc_status_open, @lc_status_partial ).

        " Process each backorder item
        LOOP AT lt_vbap_items INTO DATA(ls_vbap_item).

          " Check ATP for the item
          ls_backorder_result = create_backorder(
            iv_material = ls_vbap_item-matnr
            iv_plant    = ls_vbap_item-werks
            iv_quantity = ls_vbap_item-zmeng
          ).

          " If stock is now available, process delivery
          IF ls_backorder_result-shortage = abap_false.
            ls_delivery_result = process_delivery( iv_sales_order ).

            " Check completion status
            check_completion(
              iv_sales_order = iv_sales_order
              iv_position    = ls_vbap_item-posnr
            ).
          ENDIF.

        ENDLOOP.

        " Handle any accumulated errors
        IF gt_errors IS NOT INITIAL.
          handle_errors( gt_errors ).
        ENDIF.

      CATCH cx_sy_sql_error cx_sy_function_call_error INTO DATA(lx_error).
        MESSAGE e012(zbackorder) WITH lx_error->get_text( ) INTO DATA(lv_message).
        " Continue processing other items even if one fails

    ENDTRY.

  ENDMETHOD.

ENDCLASS.