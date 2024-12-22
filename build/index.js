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
        return get(this.mergedConfigs, path, defaultValue);
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
                    this.ready = true;
                    resolve();
                }).catch((reason) => {
                    reject(reason);
                });
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