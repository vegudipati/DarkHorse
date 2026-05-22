 const { verifyGeneratedCode, resolveMcpPort } =
    require('C:/99-AI Projects/DarkHorse/extensions/darkhorse-pipeline/out/CleanCoreVerifier');

  const sample = `
  REPORT z_backorder_check.
  " hallucinated exit
  PERFORM userexit_atp_quantity USING lv_qty.
  " direct SELECT on SAP table (Level C)
  SELECT * FROM vbak INTO TABLE lt_orders WHERE vkorg = '1000'.
  " BAPI where RAP/EML should be used
  CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'
    EXPORTING order_header_in = ls_header.
  " real SD save exit (Level B)
  ENHANCEMENT ZBO_001 USEREXIT_SAVE_DOCUMENT_PREPARE.
  ENDENHANCEMENT.
  `;

  (async () => {
    const report = await verifyGeneratedCode(sample, resolveMcpPort());
    console.log(JSON.stringify(report, null, 2));
  })();