*Assumption: Since NROB (Number Range Object) cannot be created directly through ABAP code, providing utility class for number range management and testing functions

CLASS zcl_numbo_utility DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES: BEGIN OF ty_number_range_config,
             object      TYPE nrobj,
             subobject   TYPE nrsub,
             nr_range_nr TYPE nrnr,
             fromnumber  TYPE nrfrom,
             tonumber    TYPE nrto,
             nrlevel     TYPE nrlevel,
             warning     TYPE nrwarning,
           END OF ty_number_range_config.

    CONSTANTS: gc_object TYPE nrobj VALUE 'ZNUMBO',
               gc_prefix TYPE string VALUE 'BO-'.

    CLASS-METHODS: get_next_number
      IMPORTING
        iv_object     TYPE nrobj DEFAULT gc_object
        iv_subobject  TYPE nrsub OPTIONAL
      RETURNING
        VALUE(rv_number) TYPE string
      RAISING
        cx_number_ranges,

      validate_configuration
      IMPORTING
        iv_object TYPE nrobj DEFAULT gc_object
      RETURNING
        VALUE(rv_valid) TYPE abap_bool
      RAISING
        cx_number_ranges,

      create_transport_entry
      IMPORTING
        iv_object TYPE nrobj DEFAULT gc_object
      RETURNING
        VALUE(rv_request) TYPE trkorr
      RAISING
        cx_number_ranges,

      test_number_generation
      IMPORTING
        iv_count TYPE i DEFAULT 10
      RETURNING
        VALUE(rt_numbers) TYPE string_table
      RAISING
        cx_number_ranges.

  PRIVATE SECTION.
    CLASS-METHODS: enqueue_number_range
      IMPORTING
        iv_object TYPE nrobj
      RAISING
        cx_number_ranges,

      dequeue_number_range
      IMPORTING
        iv_object TYPE nrobj.

ENDCLASS.

CLASS zcl_numbo_utility IMPLEMENTATION.

  METHOD get_next_number.
    DATA: lv_nr_number TYPE nrnr VALUE '01',
          lv_number    TYPE nrnum,
          lv_returncode TYPE sy-subrc.

    " Enqueue number range object for thread safety
    enqueue_number_range( iv_object ).

    TRY.
        CALL FUNCTION 'NUMBER_GET_NEXT'
          EXPORTING
            nr_range_nr             = lv_nr_number
            object                  = iv_object
            subobject               = iv_subobject
          IMPORTING
            number                  = lv_number
            returncode              = lv_returncode
          EXCEPTIONS
            interval_not_found      = 1
            number_range_not_extern = 2
            object_not_found        = 3
            quantity_is_0           = 4
            quantity_is_not_1       = 5
            interval_overflow       = 6
            buffer_overflow         = 7
            OTHERS                  = 8.

        IF sy-subrc <> 0 OR lv_returncode <> 0.
          MESSAGE ID sy-msgid TYPE 'E' NUMBER sy-msgno
            WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
            INTO DATA(lv_message).
          RAISE EXCEPTION TYPE cx_number_ranges
            EXPORTING
              textid = cx_number_ranges=>number_not_assignable
              value  = |{ iv_object }|.
        ENDIF.

        " Format with prefix as per business requirement
        rv_number = |{ gc_prefix }{ lv_number ALPHA = OUT }|.

      CLEANUP.
        " Ensure dequeue in case of exception
        dequeue_number_range( iv_object ).
    ENDTRY.

    " Dequeue number range object
    dequeue_number_range( iv_object ).

  ENDMETHOD.

  METHOD validate_configuration.
    DATA: lt_intervals TYPE TABLE OF nriv,
          ls_interval  TYPE nriv.

    SELECT SINGLE object FROM nrobj
      INTO @DATA(lv_exists)
      WHERE object = @iv_object.

    IF sy-subrc <> 0.
      rv_valid = abap_false.
      RETURN.
    ENDIF.

    " Check if interval 01 exists and is properly configured
    CALL FUNCTION 'NUMBER_RANGE_INTERVAL_GET'
      EXPORTING
        object                    = iv_object
        subobject                 = space
      TABLES
        interval                  = lt_intervals
      EXCEPTIONS
        interval_not_found        = 1
        number_range_not_extern   = 2
        object_not_found          = 3
        subobject_not_found       = 4
        OTHERS                    = 5.

    IF sy-subrc = 0.
      READ TABLE lt_intervals INTO ls_interval
        WITH KEY nrrangenr = '01'.
      
      IF sy-subrc = 0 AND 
         ls_interval-fromnumber = '000000001' AND
         ls_interval-tonumber = '999999999' AND
         ls_interval-nrlevel = '9'.
        rv_valid = abap_true.
      ELSE.
        rv_valid = abap_false.
      ENDIF.
    ELSE.
      rv_valid = abap_false.
    ENDIF.

  ENDMETHOD.

  METHOD create_transport_entry.
    DATA: lo_transport TYPE REF TO cl_cts_request,
          lv_request   TYPE trkorr.

    " Create customizing transport request for number range configuration
    TRY.
        lo_transport = cl_cts_request=>create_request(
          iv_type        = 'K'  " Customizing request
          iv_description = |Number Range Object { iv_object } Configuration|
        ).
        
        rv_request = lo_transport->get_request( ).

        " Add number range object to transport
        CALL FUNCTION 'TR_OBJECT_INSERT'
          EXPORTING
            wi_tr_request      = rv_request
            wi_tr_object       = 'NROB'
            wi_tr_obj_name     = iv_object
            wi_tr_operation    = 'I'
          EXCEPTIONS
            tr_object_inserted = 1
            tr_wrong_request   = 2
            OTHERS             = 3.

        IF sy-subrc <> 0.
          RAISE EXCEPTION TYPE cx_number_ranges
            EXPORTING
              textid = cx_number_ranges=>transport_error.
        ENDIF.

      CATCH cx_cts_object_not_found
            cx_parameter_invalid_type
            cx_parameter_invalid_range INTO DATA(lx_transport).
        
        RAISE EXCEPTION TYPE cx_number_ranges
          EXPORTING
            textid   = cx_number_ranges=>transport_error
            previous = lx_transport.
    ENDTRY.

  ENDMETHOD.

  METHOD test_number_generation.
    DATA: lv_counter TYPE i.

    CLEAR rt_numbers.

    DO iv_count TIMES.
      lv_counter = sy-index.
      
      TRY.
          DATA(lv_number) = get_next_number( iv_object = gc_object ).
          APPEND lv_number TO rt_numbers.
          
        CATCH cx_number_ranges INTO DATA(lx_error).
          " Log error but continue with remaining numbers
          MESSAGE |Error generating number { lv_counter }: { lx_error->get_text( ) }| TYPE 'W'.
          EXIT. " Stop on first error to prevent flooding
      ENDTRY.
    ENDDO.

    IF lines( rt_numbers ) = 0.
      RAISE EXCEPTION TYPE cx_number_ranges
        EXPORTING
          textid = cx_number_ranges=>no_number_assigned.
    ENDIF.

  ENDMETHOD.

  METHOD enqueue_number_range.
    CALL FUNCTION 'ENQUEUE_EXNRRANGE'
      EXPORTING
        mode_nriv      = 'E'
        object         = iv_object
        subobject      = space
        nrrangenr      = '01'
      EXCEPTIONS
        foreign_lock   = 1
        system_failure = 2
        OTHERS         = 3.

    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE cx_number_ranges
        EXPORTING
          textid = cx_number_ranges=>enqueue_error.
    ENDIF.

  ENDMETHOD.

  METHOD dequeue_number_range.
    CALL FUNCTION 'DEQUEUE_EXNRRANGE'
      EXPORTING
        mode_nriv      = 'E'
        object         = iv_object
        subobject      = space
        nrrangenr      = '01'.
  ENDMETHOD.

ENDCLASS.

*----------------------------------------------------------------------*
* Test Report for ZNUMBO Number Range Object
*----------------------------------------------------------------------*
REPORT znumbo_test.

PARAMETERS: p_count TYPE i DEFAULT 5 OBLIGATORY.

START-OF-SELECTION.
  
  DATA(lo_utility) = NEW zcl_numbo_utility( ).

  " Validate configuration first
  TRY.
      DATA(lv_valid) = lo_utility->validate_configuration( ).
      
      IF lv_valid = abap_true.
        WRITE: / 'Number range object ZNUMBO configuration is valid'.
        
        " Generate test numbers
        DATA(lt_numbers) = lo_utility->test_number_generation( iv_count = p_count ).
        
        WRITE: / 'Generated numbers:'.
        LOOP AT lt_numbers INTO DATA(lv_number).
          WRITE: / sy-tabix, lv_number.
        ENDLOOP.
        
      ELSE.
        WRITE: / 'Number range object ZNUMBO configuration is invalid or missing'.
        WRITE: / 'Please create via SNRO with the following settings:'.
        WRITE: / '- Object: ZNUMBO'.
        WRITE: / '- Interval 01: 000000001 to 999999999'.
        WRITE: / '- External numbering: blank'.
        WRITE: / '- Number length: 9 characters'.
        WRITE: / '- Warning percentage: 90%'.
      ENDIF.
      
    CATCH cx_number_ranges INTO DATA(lx_error).
      WRITE: / 'Error:', lx_error->get_text( ).
      WRITE: / 'Please check number range configuration in SNRO'.
  ENDTRY.