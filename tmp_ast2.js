const fs=require('fs');const vm=require('vm');vm.runInThisContext(fs.readFileSync('/home/runner/workspace/simulator/cloomc_compiler.js','utf8'));const c=new CLOOMCCompiler();
const e='λf.λx.x';
console.log(c._tokenizeLambda(e));
console.log(JSON.stringify(c._parseLambdaExpr(e),null,2));
