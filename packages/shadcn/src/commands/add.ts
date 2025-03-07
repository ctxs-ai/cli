import path from "path"
import { runInit } from "@/src/commands/init"
import { preFlightAdd } from "@/src/preflights/preflight-add"
import { getRegistryIndex } from "@/src/registry/api"
import { addComponents } from "@/src/utils/add-components"
import { createProject } from "@/src/utils/create-project"
import * as ERRORS from "@/src/utils/errors"
import { getConfig } from "@/src/utils/get-config"
import { handleError } from "@/src/utils/handle-error"
import { highlighter } from "@/src/utils/highlighter"
import { logger } from "@/src/utils/logger"
import { Command } from "commander"
import prompts from "prompts"
import { z } from "zod"

const DEPRECATED_COMPONENTS = [
  {
    name: "toast",
    deprecatedBy: "sonner",
    message:
      "The toast component is deprecated. Use the sonner component instead.",
  },
  {
    name: "toaster",
    deprecatedBy: "sonner",
    message:
      "The toaster component is deprecated. Use the sonner component instead.",
  },
]

export const addOptionsSchema = z.object({
  components: z.array(z.string()).optional(),
  yes: z.boolean(),
  overwrite: z.boolean(),
  cwd: z.string(),
  all: z.boolean(),
  path: z.string().optional(),
  silent: z.boolean(),
  srcDir: z.boolean().optional(),
  cssVariables: z.boolean(),
  skipPreflight: z.boolean().optional(),
})

export const add = new Command()
  .name("add")
  .description("add a component to your project")
  .argument(
    "[components...]",
    "the components to add or a url to the component."
  )
  .option("-y, --yes", "skip confirmation prompt.", false)
  .option("-o, --overwrite", "overwrite existing files.", false)
  .option(
    "-c, --cwd <cwd>",
    "the working directory. defaults to the current directory.",
    process.cwd()
  )
  .option("-a, --all", "add all available components", false)
  .option("-p, --path <path>", "the path to add the component to.")
  .option("-s, --silent", "mute output.", false)
  .option(
    "--src-dir",
    "use the src directory when creating a new project.",
    false
  )
  .option(
    "--no-src-dir",
    "do not use the src directory when creating a new project."
  )
  .option("--css-variables", "use css variables for theming.", true)
  .option("--no-css-variables", "do not use css variables for theming.")
  .option("--skip-preflight", "skip preflight checks for components.json and tailwind config")
  .action(async (components, opts) => {
    try {
      const options = addOptionsSchema.parse({
        components,
        cwd: path.resolve(opts.cwd),
        ...opts,
      })

      if (!options.components?.length) {
        options.components = await promptForRegistryComponents(options)
      }
      console.log("options.components", options.components)

      const config = await getConfig(options.cwd)
      if (!config) {
        logger.break()
        handleError(new Error("Failed to get config."))
        return
      }

      await addComponents(options.components, config, options)
    } catch (error) {
      logger.break()
      handleError(error)
    }
  })

async function promptForRegistryComponents(
  options: z.infer<typeof addOptionsSchema>
) {
  const registryIndex = await getRegistryIndex()
  if (!registryIndex) {
    logger.break()
    handleError(new Error("Failed to fetch registry index."))
    return []
  }

  if (options.all) {
    return registryIndex
      .map((entry) => entry.name)
  }

  if (options.components?.length) {
    return options.components
  }

  const { components } = await prompts({
    type: "multiselect",
    name: "components",
    message: "Which components would you like to add?",
    hint: "Space to select. A to toggle all. Enter to submit.",
    instructions: false,
    choices: registryIndex
      .map((entry) => ({
        title: entry.name,
        value: `/gh/${entry.author}/${entry.name}.json`,
        selected: options.all ? true : options.components?.includes(entry.name),
      })),
  })

  if (!components?.length) {
    logger.warn("No components selected. Exiting.")
    logger.info("")
    process.exit(1)
  }

  const result = z.array(z.string()).safeParse(components)
  if (!result.success) {
    logger.error("")
    handleError(new Error("Something went wrong. Please try again."))
    return []
  }
  return result.data
}
