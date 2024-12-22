'use strict';

import { promises as fs } from 'node:fs';

import { createMerger } from "smob";
import toml from 'toml';
import yaml from 'yaml';

const merge = createMerger({ priority: 'right'});

/**
 * Get a value from an object using a path. From the "You Don't need 
 * Lodash/Underscore" article at https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore?tab=readme-ov-file#_get
 * @param obj The oject to get the value from
 * @param path The path to the value
 * @param defaultValue A default value to return if the path is not found
 * @returns The value at the path or the default value
 */
function get(obj:object, path:string, defaultValue:unknown = undefined)
:unknown {
  const travel = (regexp:RegExp) =>
    String.prototype.split
      .call(path, regexp)
      .filter(Boolean)
      .reduce((res:unknown, key:string) => {
        return (res !== null && res !== undefined
          ? ((res as Record<string, unknown>)[key])
          : res)
      }, obj);
  const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);
  return result === undefined || result === obj ? defaultValue : result;
};

/**
 * Configuration class that loads configurations from files or objects and
 * merges them together. The configurations can be reloaded at any time, and
 * the class provides a way to get values from the configuration using a path.
 * The class supports JSON, YAML, TOML, and JavaScript module files.
 * @example
 * ```javascript
 * const config = new Config('default-config.json', 'additional-config.yaml');
 * await config.loadConfigs();
 * console.log(config.get('some.path.to.value'));
 * ```
 * @example
 * ```javascript
 * const config = new Config({ key: 'value' }, 'additional-config.yaml');
 * await config.loadConfigs();
 * console.log(config.get('key'));
 * ```
 */
class Config {

  /**
   * Set to `false` until the configs are loaded. Remains `true` after that,
   * even if the configs are reloaded.
   */
  private ready = false;
  private loadConfigsPromise: Promise<void>|null = null;
  mergedConfigs: object = {};
  private _sources: (object|string)[] = [];

  /**
   * Create a Config object with one or more sources. The sources can be either
   * file paths or objects. The first source is the default configuration, and
   * the rest are additional sources. The default configuration is merged with
   * the additional sources, with the additional sources taking precedence.
   * @param defaultConfig The default configuration. This is really a
   *  nudge to the user to provide a default configuration, and there is no
   *  special treatment for it compared to other sources, except that it is
   *  first (lowest priority) in the list of sources.
   * @param sources Any additional configuration sources. These are merged
   *  with the default configuration, with the sources later in the list
   *  taking precedence.
   */
  constructor(defaultConfig:string|object = {}, ...sources:(string|object)[]) {
    this._sources.push(defaultConfig, ...sources);
  }

  get isReady(): boolean {
    return this.ready;
  }
  /**
   * Returns the sources of the configuration. The sources can be either
   * file paths or objects.
   */
  get sources(): (object|string)[] {
    return this._sources;
  }  

  /**
   * Add one or more sources to the configuration. The sources can be either
   * file paths or objects. If the configuration is already loaded, the new
   * sources are loaded immediately.
   * @param newSources sources to add to the configuration. These are added to
   *  the end of the list, so they have the highest priority.
   * @returns Returns a function when this is done. If the sources are to be
   *  automatically loaded, the function returns a promise that resolves when
   *  the reload is complete. If the sources are not automatically loaded, the
   *  promise resolves immediately.
   */
  async addSource(...newSources:(string|object)[]): Promise<void> {
    this.sources.push(...newSources);
    if (this.ready) {
      await this.loadConfigs();
    }
  }

  /**
   * Get a configuration value using a path. If the path is not found, the
   * default value is returned.
   * @param path The path to the value
   * @param defaultValue A default value to return if the path is not found
   * @throws Error if the configuration is not loaded
   * @returns The value at the path or the default value
   */
  get(path: string, defaultValue: unknown = undefined): unknown {
    if (!this.ready) {
      throw new Error('Configuration not loaded yet. Call loadConfigs() and ' +
        'await its promised completion first.');
    }
    return get(this.mergedConfigs, path, defaultValue);
  }

  /**
   * Loads a single configuration file
   * @param filePath 
   * @returns 
   */
  private async loadFromFile(filePath: string): Promise<object> {
    const fileContent = (await fs.readFile(filePath)).toString();

    // checks the file extension to determine the parser. Supports YAML, JSON,
    // TOML, and JavaScript modules.
    const extension = filePath.split('.').pop();
    let parsedContent: object;
    switch (extension) {
      case 'json':
        parsedContent = JSON.parse(fileContent);
        break;
      case 'yaml':
      case 'yml':
        parsedContent = yaml.parse(fileContent);
        break;
      case 'toml':
        parsedContent = toml.parse(fileContent);
        break;
      case 'js':
        // dynamically import the module and call the default export to get the
        // configuration object
        parsedContent = (await import(filePath)).default;
        break;
      default:
        throw new Error(`Unsupported file extension: ${extension}`);
    }
    return parsedContent;
  }

  /**
   * Loads the configurations from the sources. If the configurations are
   * already loaded, this function does nothing. If the configurations are
   * being loaded, this function waits for the loading to finish before
   * returning.
   */
  loadConfigs(): Promise<void> {
    if (this.loadConfigsPromise) {
      // guard to prevent multiple reloads at the same time
      return this.loadConfigsPromise;
    } else {
      this.loadConfigsPromise = new Promise((resolve, reject) => {
        const loadingSources:(object|Promise<object>)[] = [];
        for (const source of this.sources) {
          if (typeof source === 'string') {
            loadingSources.push(this.loadFromFile(source));
          } else {
            loadingSources.push(source);
          };
        }
        Promise.all(loadingSources)
        .then((resolvedSources) => {
          this.mergedConfigs = merge(...resolvedSources);
          this.ready = true;
          resolve();
        }).catch((reason) => {
          reject(reason);})
        });
      return this.loadConfigsPromise;
    }
  }

  /**
   * Removes a source from the configuration. If the source is not found,
   * nothing happens. The source can be a string or an object; the string
   * must be an exact match in value, the object must be an exact match in
   * reference.
   * @returns Returns a function when this is done. If the sources are to be
   *  automatically loaded, the function returns a promise that resolves when
   *  the reload is complete. If the sources are not automatically loaded, the
   *  promise resolves immediately.
   */
  async removeSource(source: string|object): Promise<void> {
    const index = this.sources.indexOf(source);
    if (index >= 0) {
      this.sources.splice(index, 1);
    }
    if (this.ready) {
      await this.loadConfigs();
    }
  }
}

export default Config;
