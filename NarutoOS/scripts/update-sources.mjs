// The center, independent updater and Swift fixtures share these sources.
export const updateSourceFiles = [
  'Update.swift',
  'UpdateRelease.swift',
  'UpdateDownload.swift',
  'UpdatePackageValidation.swift',
  'UpdateTaskRecord.swift',
];

export const updateSourcePaths = updateSourceFiles.map(file => `src/prototype/native/${file}`);
