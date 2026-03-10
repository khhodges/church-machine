const fs=require('fs');const vm=require('vm');vm.runInThisContext(fs.readFileSync('/home/runner/workspace/simulator/cloomc_compiler.js','utf8'));const c=new CLOOMCCompiler();
const expr='let id = λx.x in (id 5)';
console.log(c._tokenizeLambda(expr));
console.log(JSON.stringify(c._parseLambdaExpr(expr),null,2));
