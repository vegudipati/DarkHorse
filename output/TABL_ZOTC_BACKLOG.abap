*Assumption: Generating DDL source for custom table ZOTC_BACKLOG with all specified fields, indexes, and table maintenance configuration

@EndUserText.label : 'Custom table for backorder processing audit trail and logging'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zotc_backlog {

  key client            : mandt not null;
  key vbeln             : vbeln_va not null;
  key posnr             : posnr_va not null;
  key created_date      : dats not null;
  key created_time      : tims not null;
  backorder_num         : char12;
  outstanding_qty       : kwmeng;
  stock_status          : char1;
  aging_days            : numc3;
  processed_by          : syuname;
  processing_date       : dats;
  include common_fields;

}

*&---------------------------------------------------------------------*
*& Secondary Index Definition
*&---------------------------------------------------------------------*
@AbapCatalog.index: [
  {
    name: 'ZOTC_BACKLOG_IDX1',
    unique: true,
    order: #ASC,
    elementNames: ['backorder_num']
  }
]

*&---------------------------------------------------------------------*
*& Foreign Key Relationships
*&---------------------------------------------------------------------*
@ObjectModel.foreignKey.association: '_SalesOrder'
@AbapCatalog.foreignKey: [
  {
    keyType: #NON_KEY,
    name: 'ZOTC_BACKLOG_FK1',
    table: 'VBAP',
    cardinality: #ONE_TO_ONE,
    elements: [
      {
        parentElement: 'vbeln',
        childElement: 'vbeln'
      },
      {
        parentElement: 'posnr',
        childElement: 'posnr'
      }
    ]
  }
]

*&---------------------------------------------------------------------*
*& Value Help and Domain References
*&---------------------------------------------------------------------*
@Consumption.valueHelpDefinition: [
  {
    entity: {
      name: 'I_SalesDocument',
      element: 'SalesDocument'
    }
  }
]

*&---------------------------------------------------------------------*
*& Field Annotations
*&---------------------------------------------------------------------*
annotate table zotc_backlog with {
  @EndUserText.label : 'Client'
  @AbapCatalog.foreignKey.keyType : #KEY
  @AbapCatalog.foreignKey.screenCheck : true
  client;

  @EndUserText.label : 'Sales Document'
  @AbapCatalog.foreignKey.screenCheck : true
  vbeln;

  @EndUserText.label : 'Sales Document Item'
  @AbapCatalog.foreignKey.screenCheck : true
  posnr;

  @EndUserText.label : 'Created Date'
  created_date;

  @EndUserText.label : 'Created Time'
  created_time;

  @EndUserText.label : 'Backorder Number'
  @Consumption.valueHelpDefinition: [
    {
      entity: {
        name: 'ZOTC_BACKLOG',
        element: 'backorder_num'
      }
    }
  ]
  backorder_num;

  @EndUserText.label : 'Outstanding Quantity'
  @Semantics.quantity.unitOfMeasure : 'VBAP.VRKME'
  outstanding_qty;

  @EndUserText.label : 'Stock Status'
  @Consumption.valueHelpDefinition: [
    {
      entity: {
        name: 'ZVH_STOCK_STATUS',
        element: 'stock_status'
      }
    }
  ]
  stock_status;

  @EndUserText.label : 'Aging Days'
  aging_days;

  @EndUserText.label : 'Processed By'
  @AbapCatalog.foreignKey.screenCheck : true
  processed_by;

  @EndUserText.label : 'Processing Date'
  processing_date;
}

*&---------------------------------------------------------------------*
*& Table Maintenance Configuration
*&---------------------------------------------------------------------*
@AbapCatalog.tableMaintenance: {
  type: #GENERATED,
  allowedOperations: ['CREATE', 'UPDATE', 'DELETE', 'DISPLAY'],
  authorizationObject: 'S_TABU_DIS',
  viewType: #MAINTENANCE_AND_TRANSPORT_ALLOWED,
  functionGroup: 'ZOTC_BACKLOG_MNT'
}