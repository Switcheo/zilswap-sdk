import * as fs from 'fs';
import * as util from 'util';

const readFile = util.promisify(fs.readFile)

export const compile = async (file: string) => {
  const code = (await readFile(file)).toString()
  return code;
}