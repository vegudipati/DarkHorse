*Assumption: Generating table definition structure using SE11 table structure format with proper field definitions

@EndUserText.label : 'Backorder Processing Audit Trail'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zbackorder_log {
  key client            : mandt not null;
  key vbeln             : vbeln_va not null;
  key posnr             : posnr_va not null;
  key process_date      : dats not null;
  key process_time      : tims not null;
  process_type          : char10 not null;
  prev_status           : char10;
  curr_status           : char10;
  include ddl_client_dependent_drop_protection;
  stock_qty             : menge_d;
  delivery_qty          : menge_d;
  error_message         : char255;
  user_name             : syuname;
  created_by            : syuname;
  created_at            : timestampl;
  changed_by            : syuname;
  changed_at            : timestampl;
}

REPORT zbackorder_log_table.

" Table definition for ZBACKORDER_LOG
" This code represents the table structure for SE11 table definition

TYPES: BEGIN OF ty_zbackorder_log,
         client         TYPE mandt,
         vbeln          TYPE vbeln_va,
         posnr          TYPE posnr_va,
         process_date   TYPE dats,
         process_time   TYPE tims,
         process_type   TYPE char10,
         prev_status    TYPE char10,
         curr_status    TYPE char10,
         stock_qty      TYPE menge_d,
         delivery_qty   TYPE menge_d,
         error_message  TYPE char255,
         user_name      TYPE syuname,
         created_by     TYPE syuname,
         created_at     TYPE timestampl,
         changed_by     TYPE syuname,
         changed_at     TYPE timestampl,
       END OF ty_zbackorder_log.

" Utility class for backorder log operations
CLASS lcl_backorder_log DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS: 
      log_process IMPORTING iv_vbeln        TYPE vbeln_va
                           iv_posnr        TYPE posnr_va
                           iv_process_type TYPE char10
                           iv_prev_status  TYPE char10 OPTIONAL
                           iv_curr_status  TYPE char10 OPTIONAL
                           iv_stock_qty    TYPE menge_d OPTIONAL
                           iv_delivery_qty TYPE menge_d OPTIONAL
                           iv_error_msg    TYPE char255 OPTIONAL,
      
      get_log_entries IMPORTING iv_vbeln TYPE vbeln_va
                               iv_posnr TYPE posnr_va OPTIONAL
                     RETURNING VALUE(rt_log) TYPE TABLE OF ty_zbackorder_log.
      
  PRIVATE SECTION.
    CLASS-METHODS: get_timestamp RETURNING VALUE(rv_timestamp) TYPE timestampl.
ENDCLASS.

CLASS lcl_backorder_log IMPLEMENTATION.
  METHOD log_process.
    DATA(ls_log) = VALUE ty_zbackorder_log(
      client = sy-mandt
      vbeln = iv_vbeln
      posnr = iv_posnr
      process_date = sy-datum
      process_time = sy-uzeit
      process_type = iv_process_type
      prev_status = iv_prev_status
      curr_status = iv_curr_status
      stock_qty = iv_stock_qty
      delivery_qty = iv_delivery_qty
      error_message = iv_error_msg
      user_name = sy-uname
      created_by = sy-uname
      created_at = get_timestamp( )
      changed_by = sy-uname
      changed_at = get_timestamp( )
    ).
    
    TRY.
        INSERT zbackorder_log FROM ls_log.
        IF sy-subrc = 0.
          COMMIT WORK.
        ELSE.
          ROLLBACK WORK.
        ENDIF.
      CATCH cx_sy_open_sql_db INTO DATA(lx_db_error).
        MESSAGE |Database error logging backorder: { lx_db_error->get_text( ) }| TYPE 'E'.
    ENDTRY.
  ENDMETHOD.
  
  METHOD get_log_entries.
    TRY.
        IF iv_posnr IS SUPPLIED.
          SELECT * FROM zbackorder_log
            INTO TABLE @rt_log
            WHERE vbeln = @iv_vbeln
              AND posnr = @iv_posnr
            ORDER BY process_date DESCENDING, process_time DESCENDING.
        ELSE.
          SELECT * FROM zbackorder_log
            INTO TABLE @rt_log
            WHERE vbeln = @iv_vbeln
            ORDER BY process_date DESCENDING, process_time DESCENDING.
        ENDIF.
      CATCH cx_sy_open_sql_db INTO DATA(lx_db_error).
        MESSAGE |Database error retrieving log entries: { lx_db_error->get_text( ) }| TYPE 'E'.
        CLEAR rt_log.
    ENDTRY.
  ENDMETHOD.
  
  METHOD get_timestamp.
    GET TIME STAMP FIELD rv_timestamp.
  ENDMETHOD.
ENDCLASS.

" Example usage for backorder processing
START-OF-SELECTION.
  " Log backorder creation
  lcl_backorder_log=>log_process( 
    iv_vbeln = '4500000001'
    iv_posnr = '000010'
    iv_process_type = 'CREATE'
    iv_curr_status = 'OPEN'
    iv_stock_qty = '0.000'
  ).
  
  " Log delivery processing
  lcl_backorder_log=>log_process(
    iv_vbeln = '4500000001'
    iv_posnr = '000010'
    iv_process_type = 'DELIVERY'
    iv_prev_status = 'OPEN'
    iv_curr_status = 'PARTIAL'
    iv_stock_qty = '50.000'
    iv_delivery_qty = '30.000'
  ).