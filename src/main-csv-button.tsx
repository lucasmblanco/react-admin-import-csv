import React from "react";
import {
  useRefresh,
  useNotify,
  useDataProvider,
  useResourceContext,
} from "react-admin";

import { ImportConfig } from "./config.interface";
import { SimpleLogger } from "./SimpleLogger";
import {
  CheckCSVValidation,
  GetCSVItems,
  GetIdsColliding,
} from "./import-controller";
import { create, update } from "./uploader";
import { translateWrapper } from "./translateWrapper";
import { ImportCsvDialogStrategy } from "./components/import-csv-dialog-strategy";
import { ImportCsvDialogEachItem } from "./components/import-csv-dialog-each-item";
import { ImportButton } from "./components/import-button";

export const MainCsvImport = (props: any) => {
  const refresh = useRefresh();
  const translate = translateWrapper();
  const dataProvider = useDataProvider();
  const resource = props.resource || useResourceContext();

  const {
    parseConfig,
    preCommitCallback,
    postCommitCallback,
    validateRow,
    transformRows,
    disableCreateMany,
    disableUpdateMany,
    disableGetMany,
    disableImportNew,
    disableImportOverwrite,
  } = props as ImportConfig;
  const disableNew = !!disableImportNew;
  const disableOverwrite = !!disableImportOverwrite;

  const logging = !!props.logging;
  let { variant, label, resourceName, chip } = props;
  const logger = new SimpleLogger("import-csv-button", true);
  logger.setEnabled(logging);

  if (!resource) {
    throw new Error(translate("csv.buttonMain.emptyResource"));
  }

  if (!label) {
    label = translate("csv.buttonMain.label", { numb: 99 });
  }

  if (!variant) {
    variant = "text";
  }

  if (!resourceName) {
    resourceName = resource;
  }

  const [open, setOpen] = React.useState(false);
  const [openAskDecide, setOpenAskDecide] = React.useState(false);
  const [values, setValues] = React.useState([] as any[]);
  const [idsConflicting, setIdsConflicting] = React.useState([] as any[]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [currentValue, setCurrentValue] = React.useState(null as any);

  const [file, setFile] = React.useState<File | null>();
  const fileName = (file && file.name) + "";

  React.useEffect(() => {
    let mounted = true;
    if (!file) {
      setOpen(false);
      return;
    }
    setOpen(true);

    async function processCSV(): Promise<[any[], boolean, any[]]> {
      // Is valid csv
      if (!file) {
        throw new Error("File not processed from input field");
      }
      logger.log("Parsing CSV file");
      const [csvRows, ogData] = await GetCSVItems(
        logging,
        translate,
        file,
        parseConfig
      );

      const csvItems = transformRows ? await transformRows(csvRows) : csvRows;

      const csvNew = validateRow
        ? await Promise.all(csvItems.map(validateRow))
        : csvItems;

      mounted && setValues(csvNew);
      // Does CSV pass user validation
      logger.log("Validating CSV file");
      // const csvItemsWithValidation = await CheckCSVValidation(
      //   logging,
      //   translate,
      //   csvItems,
      //   validateRow
      // );
      setValues(csvNew);
      // Are there any import overwrites?
      logger.log("Checking rows to import");
      const collidingIds = await GetIdsColliding(
        logging,
        translate,
        dataProvider,
        csvNew,
        resourceName,
        disableGetMany
      );
      mounted && setIdsConflicting(collidingIds);
      const hasCollidingIds = !!collidingIds.length;
      logger.log("Has colliding ids?", { hasCollidingIds, collidingIds });
      if (!hasCollidingIds) {
        return [csvNew as any[], hasCollidingIds, ogData];
      }
      // Ask Replace X Rows? Skip these rows? Decied For Each?
      const collidingIdsStringsSet = new Set(collidingIds.map((id) => id + ""));
      const collidingIdsNumbersSet = new Set();

      const collidingIdsAsNumbers = collidingIds.map((id) =>
        parseFloat(id + "")
      );
      const allCollidingIdsAreNumbers = collidingIdsAsNumbers.every((id) =>
        isFinite(id)
      );
      if (allCollidingIdsAreNumbers) {
        collidingIdsAsNumbers.map((id) => collidingIdsNumbersSet.add(id));
      }
      function idNotInNumbersOrStrings(item: any) {
        const matchesIdString = collidingIdsStringsSet.has(item.id + "");
        const matchesIdNumber = collidingIdsNumbersSet.has(+item.id);
        return !(matchesIdNumber || matchesIdString);
      }
      const csvItemsNotColliding = csvItems.filter(idNotInNumbersOrStrings);
      logger.log("Importing items which arent colliding", {
        csvItemsNotColliding,
      });

      // const csvNewCheckErrors = csvNew.map((item: any) => {
      //   if (!item.report.getErrorStatus()) {
      //     console.log('validado correctamente');
      //     item.report.setDetails("The row was successfully validated");
      //   }
      //   return item;
      // })

      return [csvNew, hasCollidingIds, csvItems];
    }

    processCSV()
      .then(async ([csvNew, hasCollidingIds, ogData]) => {
        await createRows(csvNew, ogData);
        mounted && !hasCollidingIds && handleClose();
      })
      .catch((error) => {
        mounted && resetVars();
        logger.error(error);
      });

    return () => {
      mounted = false;
    };
  }, [file]);

  let refInput: HTMLInputElement;

  function resetVars() {
    setOpen(false);
    setOpenAskDecide(false);
    setValues([]);
    setIdsConflicting([]);
    setIsLoading(false);
    setFile(null);
  }

  async function createRows(vals: any[], csvItems?: any[]) {
    return create(
      logging,
      disableCreateMany,
      dataProvider,
      resourceName,
      vals,
      preCommitCallback,
      postCommitCallback,
      file,
      parseConfig,
      csvItems
    );
  }

  async function updateRows(vals: any[]) {
    return update(
      logging,
      disableUpdateMany,
      dataProvider,
      resourceName,
      vals,
      preCommitCallback,
      postCommitCallback
    );
  }

  function clickImportButton() {
    resetVars();
    refInput.value = "";
    refInput.click();
  }

  const onFileAdded = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    setFile(file);
  };

  // const notify = useNotify();
  const handleClose = () => {
    logger.log("handleClose", { file });
    resetVars();
    // notify(translate("csv.dialogImport.alertClose", { fname: fileName }), {
    //   type: "info",
    // });
    refresh();
  };

  const handleReplace = async () => {
    logger.log("handleReplace");
    try {
      setIsLoading(true);
      await new Promise((res) => setTimeout(res, 1000));
      const collidingIdsSet = new Set(idsConflicting.map((id) => id));
      const valuesColliding = values.filter((item) =>
        collidingIdsSet.has(item.id)
      );
      await updateRows(valuesColliding);
      handleClose();
    } catch (error) {
      setIsLoading(false);
      logger.error("handleReplace", error);
    }
  };

  const handleSkip = () => {
    logger.log("handleSkip");
    handleClose();
  };

  const handleAskDecide = async () => {
    logger.log("handleAskDecide");
    setOpen(false);
    nextConflicting();
    setOpenAskDecide(true);
  };

  const nextConflicting = () => {
    const currentId = Array.isArray(idsConflicting) && idsConflicting.pop();
    setIdsConflicting(idsConflicting);
    const foundValue =
      Array.isArray(values) && values.filter((v) => v.id === currentId).pop();
    logger.log("nextConflicting", { foundValue, currentId });
    const isLast = !foundValue;
    if (!isLast) {
      setCurrentValue(foundValue);
    }
    return foundValue && { ...foundValue };
  };

  const handleAskDecideReplace = async () => {
    logger.log("handleAskDecideReplace");
    await updateRows([currentValue]);
    const val = nextConflicting();
    if (!val) {
      return handleClose();
    }
  };

  const handleAskDecideAddAsNew = async () => {
    logger.log("handleAskDecideAddAsNew");
    const localCopy = Object.assign({}, currentValue);
    delete localCopy.id;
    await createRows([localCopy]);
    const val = nextConflicting();
    if (!val) {
      return handleClose();
    }
  };

  const handleAskDecideSkip = async () => {
    logger.log("handleAskDecideSkip");
    const val = nextConflicting();
    if (!val) {
      return handleClose();
    }
  };

  const handleAskDecideSkipAll = async () => {
    logger.log("handleAskDecideSkipAll");
    handleClose();
  };

  return (
    <>
      {/* IMPORT BUTTON */}
      <ImportButton
        variant={variant}
        label={label}
        clickImportButton={clickImportButton}
        onFileAdded={onFileAdded}
        onRef={(ref) => (refInput = ref)}
        chip={chip}
      />

      {/* IMPORT DIALOG */}
      <ImportCsvDialogStrategy
        disableImportOverwrite={disableOverwrite}
        resourceName={resourceName}
        fileName={fileName}
        count={values && values.length}
        handleClose={handleClose}
        handleReplace={handleReplace}
        handleSkip={handleSkip}
        handleAskDecide={handleAskDecide}
        open={open}
        isLoading={isLoading}
        idsConflicting={idsConflicting}
      />
      {/* IMPORT ASK DECIDE */}
      <ImportCsvDialogEachItem
        disableImportNew={disableNew}
        disableImportOverwrite={disableOverwrite}
        currentValue={currentValue}
        resourceName={resourceName}
        values={values}
        fileName={fileName}
        openAskDecide={openAskDecide}
        handleClose={handleClose}
        handleAskDecideReplace={handleAskDecideReplace}
        handleAskDecideAddAsNew={handleAskDecideAddAsNew}
        handleAskDecideSkip={handleAskDecideSkip}
        handleAskDecideSkipAll={handleAskDecideSkipAll}
        isLoading={isLoading}
        idsConflicting={idsConflicting}
      />
    </>
  );
};
