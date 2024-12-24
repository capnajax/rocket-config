'use strict';
import { promises as fs } from 'node:fs';
import { createMerger } from "smob";
import toml from 'toml';
import yaml from 'yaml';
const merge = createMerger({ priority: 'right' });
/**
 * Get a value from an object using a path. From the "You Don't need
 * Lodash/Underscore" article at https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore?tab=readme-ov-file#_get
 * @param obj The oject to get the value from
 * @param path The path to the value
 * @param defaultValue A default value to return if the path is not found
 * @returns The value at the path or the default value
 */
function get(obj, path, defaultValue = undefined) {
    const travel = (regexp) => String.prototype.split
        .call(path, regexp)
        .filter(Boolean)
        .reduce((res, key) => {
        return (res !== null && res !== undefined
            ? (res[key])
            : res);
    }, obj);
    const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);
    return result === undefined || result === obj ? defaultValue : result;
}
;
function deepFreeze(obj) {
    for (const value of Object.values(obj)) {
        if (typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }
    if (!Object.isFrozen(obj)) {
        Object.freeze(obj);
    }
}
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
    static _globalConfig = null;
    static set globalConfig(config) {
        Config._globalConfig = config;
    }
    static async init(defaultConfig = {}, ...sources) {
        Config._globalConfig = new Config(defaultConfig, ...sources);
        await Config._globalConfig.loadConfigs();
        return Config.c;
    }
    static get c() {
        if (!Config._globalConfig) {
            throw new Error('Global configuration not set. Call initGlobalConfig() ' +
                'first.');
        }
        if (!Config._globalConfig.isReady) {
            throw new Error('Global configuration not loaded yet. Call ' +
                'loadConfigs() and await its promised completion first.');
        }
        return Config._globalConfig;
    }
    /**
     * Set to `false` until the configs are loaded. Remains `true` after that,
     * even if the configs are reloaded.
     */
    ready = false;
    loadConfigsPromise = null;
    mergedConfigs = {};
    _sources = [];
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
    constructor(defaultConfig = {}, ...sources) {
        this._sources.push(defaultConfig, ...sources);
    }
    get isReady() {
        return this.ready;
    }
    get config() {
        return this.mergedConfigs;
    }
    /**
     * Returns the sources of the configuration. The sources can be either
     * file paths or objects.
     */
    get sources() {
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
    async addSource(...newSources) {
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
    get(path, defaultValue = undefined) {
        if (!this.ready) {
            throw new Error('Configuration not loaded yet. Call loadConfigs() and ' +
                'await its promised completion first.');
        }
        if (!path) {
            return this.mergedConfigs;
        }
        else {
            return get(this.mergedConfigs, path, defaultValue);
        }
    }
    /**
     * Loads a single configuration file
     * @param filePath
     * @returns
     */
    async loadFromFile(filePath) {
        const fileContent = (await fs.readFile(filePath)).toString();
        // checks the file extension to determine the parser. Supports YAML, JSON,
        // TOML, and JavaScript modules.
        const extension = filePath.split('.').pop();
        let parsedContent;
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
                parsedContent = (await import('data:text/javascript,' + fileContent)
                    .then((module) => {
                    if (typeof module.default === 'function') {
                        return module.default();
                    }
                    else {
                        return module.default;
                    }
                })
                    .catch((error) => {
                    console.error(`Error loading JavaScript config module ${filePath}: ${error}`);
                    return {};
                }));
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
    loadConfigs() {
        if (this.loadConfigsPromise) {
            // guard to prevent multiple reloads at the same time
            return this.loadConfigsPromise;
        }
        else {
            this.loadConfigsPromise = new Promise((resolve, reject) => {
                const loadingSources = [];
                for (const source of this.sources) {
                    if (typeof source === 'string') {
                        loadingSources.push(this.loadFromFile(source));
                    }
                    else {
                        loadingSources.push(source);
                    }
                    ;
                }
                Promise.all(loadingSources)
                    .then((resolvedSources) => {
                    this.mergedConfigs = merge(...resolvedSources);
                    deepFreeze(this.mergedConfigs);
                    this.ready = true;
                    resolve();
                }).catch((reason) => {
                    reject(reason);
                });
            }).finally(() => {
                this.loadConfigsPromise = null;
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
    async removeSource(source) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWSxDQUFDO0FBRWIsT0FBTyxFQUFFLFFBQVEsSUFBSSxFQUFFLEVBQUUsTUFBTSxTQUFTLENBQUM7QUFFekMsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLE1BQU0sQ0FBQztBQUNwQyxPQUFPLElBQUksTUFBTSxNQUFNLENBQUM7QUFDeEIsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFDO0FBRXhCLE1BQU0sS0FBSyxHQUFHLFlBQVksQ0FBQyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFDO0FBRWpEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLEdBQUcsQ0FBQyxHQUFVLEVBQUUsSUFBVyxFQUFFLGVBQXVCLFNBQVM7SUFFcEUsTUFBTSxNQUFNLEdBQUcsQ0FBQyxNQUFhLEVBQUUsRUFBRSxDQUMvQixNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUs7U0FDbkIsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUM7U0FDbEIsTUFBTSxDQUFDLE9BQU8sQ0FBQztTQUNmLE1BQU0sQ0FBQyxDQUFDLEdBQVcsRUFBRSxHQUFVLEVBQUUsRUFBRTtRQUNsQyxPQUFPLENBQUMsR0FBRyxLQUFLLElBQUksSUFBSSxHQUFHLEtBQUssU0FBUztZQUN2QyxDQUFDLENBQUMsQ0FBRSxHQUErQixDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3pDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNWLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNaLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDekQsT0FBTyxNQUFNLEtBQUssU0FBUyxJQUFJLE1BQU0sS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFD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