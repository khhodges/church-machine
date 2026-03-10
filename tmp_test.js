const fs=require('fs');const vm=require('vm');
const code=fs.readFileSync('/home/runner/workspace/simulator/cloomc_compiler.js','utf8');
vm.runInThisContext(code);
const c=new CLOOMCCompiler();
const samples={
hsComment:`-- Church Machine Lambda Calculus
abstraction ChurchMath {
  capabilities { }
  method successor(n) = n + 1
}`,
hsPlain:`abstraction H {
  capabilities { }
  method successor(n) = n + 1
}`,
lambda:`-- LAMBDA CALCULUS
abstraction L {
  capabilities { }
  method id(x) = λy.y
}`
};
for(const [k,s] of Object.entries(samples)){
  const r=c.compile(s,[]);
  console.log(k,'=>',r.language,'errors',r.errors.length);
}
