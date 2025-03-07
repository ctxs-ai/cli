import path from "path"
import { Config } from "@/src/utils/get-config"
import { handleError } from "@/src/utils/handle-error"
import { highlighter } from "@/src/utils/highlighter"
import { logger } from "@/src/utils/logger"
import deepmerge from "deepmerge"
import { HttpsProxyAgent } from "https-proxy-agent"
import fetch from "node-fetch"
import { z } from "zod"

import {
  iconsSchema,
  registryBaseColorSchema,
  registryIndexSchema,
  registryItemSchema,
  registryResolvedItemsTreeSchema,
  stylesSchema,
} from "./schema"

const REGISTRY_URL = process.env.REGISTRY_URL ?? "https://ctxs.ai/r"

const agent = process.env.https_proxy
  ? new HttpsProxyAgent(process.env.https_proxy)
  : undefined

const registryCache = new Map<string, Promise<any>>()

export async function getRegistryIndex() {
  try {
    const [result] = await fetchRegistry(["index.json"])

    return registryIndexSchema.parse(result)
  } catch (error) {
    logger.error("\n")
    handleError(error)
  }
}

export async function getRegistryItem(name: string, style: string) {
  try {
    const [result] = await fetchRegistry([
      isUrl(name) ? name : `styles/${style}/${name}.json`,
    ])

    return registryItemSchema.parse(result)
  } catch (error) {
    logger.break()
    handleError(error)
    return null
  }
}

export async function resolveTree(
  index: z.infer<typeof registryIndexSchema>,
  names: string[]
) {
  const tree: z.infer<typeof registryIndexSchema> = []

  for (const name of names) {
    const entry = index.find((entry) => entry.name === name)

    if (!entry) {
      continue
    }

    tree.push(entry)

    if (entry.registryDependencies) {
      const dependencies = await resolveTree(index, entry.registryDependencies)
      tree.push(...dependencies)
    }
  }

  return tree.filter(
    (component, index, self) =>
      self.findIndex((c) => c.name === component.name) === index
  )
}

export async function fetchTree(
  style: string,
  tree: z.infer<typeof registryIndexSchema>
) {
  try {
    const paths = tree.map((item) => `styles/${style}/${item.name}.json`)
    const result = await fetchRegistry(paths)
    return registryIndexSchema.parse(result)
  } catch (error) {
    handleError(error)
  }
}

export async function getItemTargetPath(
  config: Config,
  item: Pick<z.infer<typeof registryItemSchema>, "type">,
  override?: string
) {
  if (override) {
    return override
  }

  const [parent, type] = item.type?.split(":") ?? []
  if (!(parent in config.resolvedPaths)) {
    return null
  }

  return path.join(
    config.resolvedPaths[parent as keyof typeof config.resolvedPaths],
    type
  )
}

export async function fetchRegistry(paths: string[]) {
  try {
    const results = await Promise.all(
      paths.map(async (path) => {
        const url = getRegistryUrl(path)

        // Check cache first
        if (registryCache.has(url)) {
          return registryCache.get(url)
        }

        // Store the promise in the cache before awaiting
        const fetchPromise = (async () => {
          const response = await fetch(url, { agent })

          if (!response.ok) {
            const errorMessages: { [key: number]: string } = {
              400: "Bad request",
              401: "Unauthorized",
              403: "Forbidden",
              404: "Not found",
              500: "Internal server error",
            }

            if (response.status === 401) {
              throw new Error(
                `You are not authorized to access the component at ${highlighter.info(
                  url
                )}.\nIf this is a remote registry, you may need to authenticate.`
              )
            }

            if (response.status === 404) {
              throw new Error(
                `The component at ${highlighter.info(
                  url
                )} was not found.\nIt may not exist at the registry. Please make sure it is a valid component.`
              )
            }

            if (response.status === 403) {
              throw new Error(
                `You do not have access to the component at ${highlighter.info(
                  url
                )}.\nIf this is a remote registry, you may need to authenticate or a token.`
              )
            }

            const result = await response.json()
            const message =
              result && typeof result === "object" && "error" in result
                ? result.error
                : response.statusText || errorMessages[response.status]
            throw new Error(
              `Failed to fetch from ${highlighter.info(url)}.\n${message}`
            )
          }

          return response.json()
        })()

        registryCache.set(url, fetchPromise)
        return fetchPromise
      })
    )

    return results
  } catch (error) {
    logger.error("\n")
    handleError(error)
    return []
  }
}

export function clearRegistryCache() {
  registryCache.clear()
}

export async function registryResolveItemsTree(
  names: z.infer<typeof registryItemSchema>["name"][],
  config: Config
) {
  try {
    const index = await getRegistryIndex()
    if (!index) {
      return null
    }

    // If we're resolving the index, we want it to go first.
    if (names.includes("index")) {
      names.unshift("index")
    }

    let registryItems = await resolveRegistryItems(names, config)
    let result = await fetchRegistry(registryItems)
    const payload = z.array(registryItemSchema).parse(result)

    if (!payload) {
      return null
    }

    return registryResolvedItemsTreeSchema.parse({
      dependencies: deepmerge.all(
        payload.map((item) => item.dependencies ?? [])
      ),
      devDependencies: deepmerge.all(
        payload.map((item) => item.devDependencies ?? [])
      ),
      files: deepmerge.all(payload.map((item) => item.files ?? [])),
    })
  } catch (error) {
    handleError(error)
    return null
  }
}

async function resolveRegistryDependencies(
  url: string,
  config: Config
): Promise<string[]> {
  const visited = new Set<string>()
  const payload: string[] = []

  async function resolveDependencies(itemUrl: string) {
    const url = getRegistryUrl(itemUrl)

    if (visited.has(url)) {
      return
    }

    visited.add(url)

    try {
      const [result] = await fetchRegistry([url])
      const item = registryItemSchema.parse(result)
      payload.push(url)

      if (item.registryDependencies) {
        for (const dependency of item.registryDependencies) {
          await resolveDependencies(dependency)
        }
      }
    } catch (error) {
      console.error(
        `Error fetching or parsing registry item at ${itemUrl}:`,
        error
      )
    }
  }

  await resolveDependencies(url)
  return Array.from(new Set(payload))
}

function getRegistryUrl(path: string) {
  if (isUrl(path)) {
    // If the url contains /chat/b/, we assume it's the v0 registry.
    // We need to add the /json suffix if it's missing.
    const url = new URL(path)
    if (url.pathname.match(/\/chat\/b\//) && !url.pathname.endsWith("/json")) {
      url.pathname = `${url.pathname}/json`
    }

    return url.toString()
  }

  return `${REGISTRY_URL}/${path}`
}

function isUrl(path: string) {
  try {
    new URL(path)
    return true
  } catch (error) {
    return false
  }
}

// TODO: We're double-fetching here. Use a cache.
export async function resolveRegistryItems(names: string[], config: Config) {
  let registryDependencies: string[] = []
  for (const name of names) {
    const itemRegistryDependencies = await resolveRegistryDependencies(
      name,
      config
    )
    registryDependencies.push(...itemRegistryDependencies)
  }

  return Array.from(new Set(registryDependencies))
}

export function getRegistryTypeAliasMap() {
  return new Map<string, string>([
    ["registry:ui", "ui"],
    ["registry:lib", "lib"],
    ["registry:hook", "hooks"],
    ["registry:block", "components"],
    ["registry:component", "components"],
  ])
}

// Track a dependency and its parent.
export function getRegistryParentMap(
  registryItems: z.infer<typeof registryItemSchema>[]
) {
  const map = new Map<string, z.infer<typeof registryItemSchema>>()
  registryItems.forEach((item) => {
    if (!item.registryDependencies) {
      return
    }

    item.registryDependencies.forEach((dependency) => {
      map.set(dependency, item)
    })
  })
  return map
}
