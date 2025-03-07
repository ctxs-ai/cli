import path from "path"
import {
  fetchRegistry,
  getRegistryParentMap,
  getRegistryTypeAliasMap,
  registryResolveItemsTree,
  resolveRegistryItems,
} from "@/src/registry/api"
import { registryItemSchema } from "@/src/registry/schema"
import {
  configSchema,
  findCommonRoot,
  findPackageRoot,
  workspaceConfigSchema,
  type Config,
} from "@/src/utils/get-config"
import { getProjectTailwindVersionFromConfig } from "@/src/utils/get-project-info"
import { handleError } from "@/src/utils/handle-error"
import { logger } from "@/src/utils/logger"
import { spinner } from "@/src/utils/spinner"
import { updateCssVars } from "@/src/utils/updaters/update-css-vars"
import { updateDependencies } from "@/src/utils/updaters/update-dependencies"
import { updateFiles } from "@/src/utils/updaters/update-files"
import { updateTailwindConfig } from "@/src/utils/updaters/update-tailwind-config"
import { z } from "zod"

export async function addComponents(
  components: string[],
  config: Config,
  options: {
    overwrite?: boolean
    silent?: boolean
    isNewProject?: boolean
  }
) {
  options = {
    overwrite: false,
    silent: false,
    isNewProject: false,
    ...options,
  }

  // const workspaceConfig = await getWorkspaceConfig(config)
  // if (
  //   workspaceConfig &&
  //   workspaceConfig.ui &&
  //   workspaceConfig.ui.resolvedPaths.cwd !== config.resolvedPaths.cwd
  // ) {
  //   return await addWorkspaceComponents(components, config, workspaceConfig, {
  //     ...options,
  //     isRemote:
  //       components?.length === 1 && !!components[0].match(/\/chat\/b\//),
  //   })
  // }

  return await addProjectComponents(components, config, options)
}

async function addProjectComponents(
  components: string[],
  config: z.infer<typeof configSchema>,
  options: {
    overwrite?: boolean
    silent?: boolean
    isNewProject?: boolean
  }
) {
  const registrySpinner = spinner(`Checking registry.`, {
    silent: options.silent,
  })?.start()
  const tree = await registryResolveItemsTree(components, config)
  if (!tree) {
    registrySpinner?.fail()
    return handleError(new Error("Failed to fetch components from registry."))
  }
  registrySpinner?.succeed()

  await updateFiles(tree.files, config, {
    overwrite: options.overwrite,
    silent: options.silent,
  })

  if (tree.docs) {
    logger.info(tree.docs)
  }
}