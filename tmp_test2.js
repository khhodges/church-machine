const fs=require('fs');const vm=require('vm');
vm.runInThisContext(fs.readFileSync('/home/runner/workspace/simulator/cloomc_compiler.js','utf8'));
const c=new CLOOMCCompiler();
const srcs={
church:`-- LAMBDA CALCULUS
abstraction ChurchNumerals {
    capabilities { }
    method zero() = λf.λx.x
    method successor(n) = n + 1
    method add(a, b) = a + b
    method multiply(a, b) = a * b
    method predecessor(n) = if n > 0 then n - 1 else 0
    method isZero(n) = if n == 0 then 1 else 0
}`,
pairs:`-- LAMBDA CALCULUS
abstraction ChurchPairs {
    capabilities { }
    method pair(a, b) = (a, b)
    method fst_(p) = fst p
    method snd_(p) = snd p
    method swap(p) = (snd p, fst p)
    method mapBoth(p, n) = (fst p + n, snd p + n)
}`,
y:`-- LAMBDA CALCULUS
abstraction YCombinator {
    capabilities { }
    method factorial(n) =
        if n == 0 then 1
        else if n == 1 then 1
        else n * (n - 1)
    method fibonacci(n) =
        if n == 0 then 0
        else if n == 1 then 1
        else n + (n - 1)
}`,
letlambda:`-- LAMBDA CALCULUS
abstraction T {
 capabilities { }
 method m() = let id = λx.x in (id 5)
}`
};
for (const [k,s] of Object.entries(srcs)) { const r=c.compile(s,[]); console.log('\n'+k,r.language,'errs',r.errors.length,'methods',r.methods.length); if(r.errors.length) console.log(r.errors.slice(0,3)); }
