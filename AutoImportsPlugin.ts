import { Compiler } from "webpack"
import * as fs from "fs"
import * as path from 'path'
import { AutoImportsPluginOptions } from "./types";
import { PartitionImports } from "./core/PartitionImports"
import { SettingsPartitionImports, InterfacePartitionImports, ImportNamesCollection } from "./core/types"

interface WebpackPlugin{
  apply(compiler: Compiler): void;
}

class AutoImportsPlugin implements WebpackPlugin{
  apply(compiler: Compiler) {
  }
  protected readonly fileSistem: Map<string, Set<string>> = new Map()
  // startDir, ext, paths wisout file
  protected readonly importsMap: Map<string, Map<string, string[]>>
  protected partitionImports: Promise<ImportNamesCollection>[]
  protected readonly options: AutoImportsPluginOptions
  constructor(options: {
    sources: string[],
    startDirs: string[],
    basenameImportFiles: string,
    importsExprGenerators: Map<string, (importPath: string) => string>,
    withoutExt?: boolean,
  }) {
    this.options = options
    this.importsMap = new Map(this.options.startDirs.map(startDir => [startDir, new Map()]))
    this.getPartitionImports()
  }
  protected getPartitionImports() {
    return new Map(this.options.startDirs.map(startDir => {
      const importedDirs = this.getPromisePartitionedImports(startDir)
        .then(this.getFlatImportNamesCollection)
        .then(importDirs => this.fillingImportsMap(importDirs, this.importsMap.get(startDir)))
        // обращается к this, а биндинг ломает вычисление типов ts. потому только стрелка
        .then(importsMap => this.generateImportTexts(importsMap))
        .then(importTexts => this.saveImportFiles(importTexts, startDir))
        .catch(e => console.error(e))
      return [startDir, importedDirs]
    }))
  }
  protected saveImportFiles(importTexts: Map<string, string>, to: string) {
    for (const ext of importTexts.keys()) {
      // файл создаётся всегда. т.к. внешние, к пакету, файлы ожидают его наличия (импортят его).
      // таков интерфейс пакета
      const importText = importTexts.get(ext).trimStart()
      const name = (ext != '.json')
        ? `${this.options.basenameImportFiles}${ext}`
        : `${this.options.basenameImportFiles}.generate${ext}`
      const filePath = path.resolve(to, name)
      fs.writeFile(filePath, importText, () => { })
    }
  }

  protected generateImportTexts(importsMap: Map<string, string[]>) {
    // всё распределено по расширениям
    const importTexts: Map<string, string> = new Map()
    for (const ext of this.options.importsExprGenerators.keys()) {
      let importTextForExt = [...new Set(importsMap.get(ext))].reduce((importText, nextImportFolder) => {
        // по соглашению: basename files === basename his folders
        const name = path.basename(nextImportFolder)
        // если использовать join, может ломаеться pug-loader. scss-loader за этим не замечен.
        let nextFilePath = path.resolve(nextImportFolder, name)

        // очевидно, в имени каталога нет расширения, оно берётся из мапы генераторов.
        // все каталоги раскидываются по расширениям их файлов в импортируемом коде.
        if (!this.options.withoutExt) {
          nextFilePath += ext
        }

        const nextImportExpr = this.options.importsExprGenerators.get(ext)(nextFilePath)

        return importText + nextImportExpr
      }, '')
      importTexts.set(ext, importTextForExt)
    }
    return importTexts
  }

  protected fillingImportsMap(importDirs: string[], importsForStartDir: Map<string, string[]>) {
    for (const importDir of importDirs) {
      for (const file of this.readdir(path.resolve(importDir)).files) {
        const ext = path.extname(file)
        if (ext == '.json' && path.basename(file, ext) == this.options.basenameImportFiles) {
          continue
        }

        let importFiles = importsForStartDir.get(ext)
        if (!importFiles) {
          importsForStartDir.set(ext, [])
          importFiles = importsForStartDir.get(ext)
        }

        importFiles.push(importDir)
      }
    }
    return importsForStartDir
  }
  protected getFlatImportNamesCollection(imports: ImportNamesCollection) {
    const importsList: string[] = []
    for (const source of imports.keys()) {
      for (const dirName of imports.get(source).values()) {
        importsList.push(path.join(source, dirName))
      }
    }
    return importsList
  }
  protected getPromisePartitionedImports(startDir: string) {
    const partitionImports = new PartitionImports({
      sources: this.options.sources,
      importsFilePath: path.join(startDir, `${this.options.basenameImportFiles}.json`)
    })
    return partitionImports.getPartitionedNamesAsync()
  }

  protected readdir(source: string) {
    const dirIncludes = {
      dirs: [] as string[],
      files: [] as string[],
    }
    for (const dirItem of fs.readdirSync(source, { withFileTypes: true })) {
      if (dirItem.isDirectory()) {
        dirIncludes.dirs.push(dirItem.name)
      } else if (dirItem.isFile()) {
        dirIncludes.files.push(dirItem.name)
      }
    }
    return dirIncludes
  }
}

export {
  AutoImportsPlugin,
  AutoImportsPluginOptions,
}
