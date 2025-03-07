import { promises as fs } from "fs"
import { tmpdir } from "os"
import path from "path"
import { registryBaseColorSchema } from "@/src/registry/schema"
import { Config } from "@/src/utils/get-config"
import { transformJsx } from "@/src/utils/transformers/transform-jsx"
import { Project, ScriptKind, type SourceFile } from "ts-morph"
import { z } from "zod"

export type TransformOpts = {
  filename: string
  raw: string
  config: Config
  baseColor?: z.infer<typeof registryBaseColorSchema>
  transformJsx?: boolean
  isRemote?: boolean
}

export type Transformer<Output = SourceFile> = (
  opts: TransformOpts & {
    sourceFile: SourceFile
  }
) => Promise<Output>

const project = new Project({
  compilerOptions: {},
})

async function createTempSourceFile(filename: string) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "ctxs-"))
  return path.join(dir, filename)
}

export async function transform(
  opts: TransformOpts,
  transformers: Transformer[] = [
  ]
) {
  const tempFile = await createTempSourceFile(opts.filename)
  const sourceFile = project.createSourceFile(tempFile, opts.raw, {
    scriptKind: ScriptKind.TSX,
  })

  for (const transformer of transformers) {
    await transformer({ sourceFile, ...opts })
  }

  if (opts.transformJsx) {
    return await transformJsx({
      sourceFile,
      ...opts,
    })
  }

  return sourceFile.getText()
}
