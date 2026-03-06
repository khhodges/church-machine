const MATH_HISTORY = {
    interactive: [
        {
            title: "Computing B\u2087: Ada's Proof That Machines Can Think (1843)",
            body: "B\u2087 is the 7th Bernoulli number, and it equals \u22121/30. Bernoulli numbers appear whenever you sum powers of integers \u2014 they are the coefficients in the formula for 1\u00b2 + 2\u00b2 + 3\u00b2 + \u2026 + n\u00b2 and higher powers. Ada Lovelace chose B\u2087 as the target for her program because it was complex enough to need loops, memory, and conditional logic, but simple enough to verify by hand.<br><br>Her algorithm used variables V1 through V15, each holding one intermediate result \u2014 exactly like typing <code>let V4 = V2 * V3</code> in Interactive Math. The program multiplied, divided, added and subtracted step by step, looping to accumulate the answer. If the final variable held \u22121/30, the program worked. If not, there was a bug.<br><br>Ada's original actually did have a small error \u2014 making the first computer program also the first program with a bug. The Church Machine's Symbolic Math compiler uses her exact notation so you can run Note G yourself and watch B\u2087 = \u22121/30 appear, just as she intended 180 years ago.",
            question: "Ada proved a machine could compute B\u2087 automatically. But she also wrote: 'The Engine has no pretensions to originate anything.' Do you agree \u2014 can a machine only do what it is told, or can it surprise us?",
            era: "Victorian England, 1843"
        },
        {
            title: "Ada Lovelace and the First Program (1843)",
            body: "In 1843, Ada Lovelace wrote what is considered the first computer program \u2014 an algorithm to compute Bernoulli numbers on Charles Babbage's Analytical Engine. She used a notation strikingly similar to what you just typed: variables V1, V2, V3... with one operation per line. She saw that the Engine could manipulate symbols, not just numbers \u2014 making her the first person to imagine general-purpose computing. The Church Machine's Interactive Math directly descends from her notation.",
            question: "Ada called the Engine 'weaving algebraic patterns just as the Jacquard loom weaves flowers and leaves.' What did she mean by that?",
            era: "Victorian England"
        },
        {
            title: "Al-Khwarizmi and the Birth of Algebra (820 AD)",
            body: "The word 'algorithm' comes from al-Khwarizmi, a Persian mathematician in Baghdad's House of Wisdom. His book 'The Compendious Book on Calculation by Completion and Balancing' gave us algebra (from 'al-jabr' meaning 'restoration'). Every time you type 'let x = 2 + 3', you are using the symbolic thinking he pioneered 1,200 years ago. He would have recognized your lambda prompt immediately.",
            question: "Al-Khwarizmi solved equations by 'completing the square.' Can you figure out what x\u00b2 + 10x = 39 gives you?",
            era: "Islamic Golden Age"
        },
        {
            title: "Bletchley Park: Math That Won a War (1939\u20131945)",
            body: "During World War II, Alan Turing and a team of mathematicians at Bletchley Park cracked the Nazi Enigma code. They did it with math \u2014 probability, modular arithmetic, and logical deduction. Turing built electromechanical 'bombes' that tested millions of combinations. The same Turing who was Alonzo Church's student at Princeton. The lambda calculus you're using right now was invented by Church, Turing's teacher.",
            question: "The Enigma machine had 158,962,555,217,826,360,000 possible settings each day. How would you even begin to narrow that down?",
            era: "World War II"
        },
        {
            title: "Ramanujan's Infinite Series (1913)",
            body: "Srinivasa Ramanujan, a self-taught mathematician from Madras, India, sent a letter to Cambridge professor G.H. Hardy containing over 100 extraordinary formulas. Hardy said some 'defeated me completely; I had never seen anything in the least like them before.' Ramanujan could see patterns in infinite series that nobody else could. One of his formulas for 1/\u03c0 converges so fast that just one term gives 8 correct digits.",
            question: "Ramanujan said his formulas came to him in dreams from the goddess Namagiri. Do you think mathematical truth is discovered or invented?",
            era: "British India"
        },
        {
            title: "The Rosetta Stone of Computing (1936)",
            body: "In 1936, three people independently invented the same idea: Alonzo Church (lambda calculus), Alan Turing (Turing machines), and Emil Post (Post production systems). All three turned out to be mathematically equivalent \u2014 anything one can compute, so can the others. This is the Church-Turing thesis. The Church Machine you're using right now is named after Alonzo Church because it runs on his lambda calculus, not Turing's machine model.",
            question: "If all three models compute the same things, why would we choose lambda calculus over Turing machines? What's the advantage?",
            era: "Princeton, 1936"
        },
        {
            title: "Grace Hopper and the First Bug (1947)",
            body: "When Grace Hopper found a moth stuck in the Harvard Mark II computer relay, she taped it into the logbook and wrote 'First actual case of bug being found.' But Hopper's real contribution was inventing the compiler \u2014 the idea that you could write in a human-readable language and have a program translate it to machine code. The CLOOMC++ compiler in the Church Machine follows directly in her footsteps.",
            question: "Hopper said 'The most dangerous phrase in the language is: We've always done it this way.' Why is that dangerous in computing?",
            era: "Post-War America"
        },
        {
            title: "The Kerala School: Calculus Before Newton (1350\u20131550)",
            body: "Two centuries before Newton and Leibniz, mathematicians in Kerala, India \u2014 Madhava, Nilakantha, and Jyeshthadeva \u2014 discovered infinite series for \u03c0, sine, cosine, and arctangent. Madhava's series for \u03c0/4 = 1 - 1/3 + 1/5 - 1/7 + ... predates Gregory and Leibniz by 200 years. Their work was written on palm leaves and transmitted orally through generations of students.",
            question: "The Kerala mathematicians had no concept of 'publishing.' How does knowledge survive when it isn't written down or widely shared?",
            era: "Medieval India"
        },
        {
            title: "Leibniz's Dream: A Calculus of Thought (1679)",
            body: "Gottfried Leibniz dreamed of a 'characteristica universalis' \u2014 a universal language of logic where all arguments could be reduced to calculation. He said: 'Let us calculate!' whenever there was a disagreement. It took 257 years, but Church and Turing finally realized his dream. The lambda calculus IS a calculus of thought. Every expression you type at the \u03bb> prompt is a tiny piece of Leibniz's vision.",
            question: "Leibniz also invented binary (0s and 1s). He saw it in the Chinese I Ching. What connections can math have across completely different cultures?",
            era: "Age of Enlightenment"
        }
    ],
    hp35: [
        {
            title: "Apollo 11: The Calculator That Went to the Moon (1969)",
            body: "When Neil Armstrong and Buzz Aldrin landed on the Moon, they carried no calculator. The Apollo Guidance Computer had less computing power than your phone's alarm clock \u2014 just 74 KB of memory and a 2 MHz clock. But HP engineers were already building the HP-35 (released 1972), the first handheld scientific calculator. Before the HP-35, engineers used slide rules. The HP-35 made the slide rule obsolete overnight.",
            question: "The Apollo computer used 15-bit words and fixed-point math. The HP-35 used floating-point. Why would floating-point matter for a moon landing?",
            era: "Space Race"
        },
        {
            title: "Bill Hewlett's Shirt-Pocket Challenge (1970)",
            body: "HP co-founder Bill Hewlett challenged his engineers: build a scientific calculator that fits in a shirt pocket. They said it was impossible. The HP-35 \u2014 named for its 35 keys \u2014 proved them wrong. It used a custom algorithm called CORDIC to compute trig functions without multiplication, running on a chip with just 767 transistors. Your phone has billions. The HP-35 cost $395 in 1972 (\u2248$2,900 today).",
            question: "CORDIC computes sin/cos by rotating a vector through smaller and smaller angles. Can you see how that's similar to a binary search?",
            era: "Silicon Valley, 1972"
        },
        {
            title: "RPN: The Notation That Divides Humanity (1920s)",
            body: "Reverse Polish Notation was invented by Jan \u0141ukasiewicz, a Polish logician, in the 1920s. Instead of writing 3 + 5, you write 3 5 +. HP adopted it because it eliminates parentheses entirely and maps directly to a stack machine. RPN users swear by it; everyone else finds it baffling. Church's lambda calculus also uses prefix notation: (+ 3 5). Both avoid the ambiguity of 'which operation comes first?'",
            question: "Calculate (3 + 4) \u00d7 (5 + 6) in RPN. How many keystrokes does it take compared to algebraic notation?",
            era: "Interwar Poland"
        },
        {
            title: "Katherine Johnson: The Human Computer (1962)",
            body: "Before NASA trusted electronic computers, they relied on 'human computers' \u2014 mathematicians who calculated trajectories by hand. Katherine Johnson verified the orbital calculations for John Glenn's Mercury flight using only a desktop mechanical calculator. When NASA got electronic computers, Glenn specifically asked Johnson to double-check the numbers. She was more trusted than the machine.",
            question: "Katherine Johnson used Euler's method for numerical integration. The HP-35 can do the same calculation in seconds. Does speed make a computer more trustworthy?",
            era: "Civil Rights Era"
        },
        {
            title: "Napier's Bones: The Original Calculator (1617)",
            body: "John Napier, a Scottish mathematician, invented logarithms in 1614 to simplify astronomical calculations. He also created 'Napier's Bones' \u2014 carved ivory rods that could multiply numbers by aligning columns. His logarithm tables reduced multiplication to addition, the same principle used by slide rules and, ultimately, by the log key on the HP-35 you're using right now.",
            question: "Napier spent 20 years computing his logarithm tables by hand. The HP-35 computes log(x) in milliseconds. What was the human cost of computation before machines?",
            era: "Renaissance Scotland"
        },
        {
            title: "The Curta: A Calculator in a Pepper Grinder (1948)",
            body: "Curt Herzstark designed the Curta calculator while imprisoned in the Buchenwald concentration camp during WWII. The Nazis let him continue because they wanted to give it to Hitler as a gift. Herzstark survived, and the Curta became real \u2014 a masterpiece of mechanical engineering the size of a pepper grinder that could add, subtract, multiply, and divide. Only 140,000 were ever made; collectors now pay thousands for one.",
            question: "Herzstark memorized his entire design without being allowed paper. What does that say about the relationship between adversity and invention?",
            era: "WWII / Post-War"
        }
    ],
    abacus: [
        {
            title: "The Silk Road: How the Abacus Conquered the World",
            body: "The abacus traveled the ancient Silk Road from Mesopotamia to China, adapting at every stop. The Roman abacus used grooves and pebbles ('calculi' \u2014 giving us the word 'calculate'). The Chinese suanpan has 2 heaven beads and 5 earth beads. The Japanese soroban (like this one) was refined to 1 heaven and 4 earth beads \u2014 the minimum needed for any digit 0\u20139. Each culture optimized the same idea differently.",
            question: "Why would the Japanese reduce the beads from 7 to 5? What advantage does fewer beads give you?",
            era: "Ancient Silk Road"
        },
        {
            title: "The Soroban vs. the Computer (1946)",
            body: "In 1946, a speed contest was held in Tokyo between Kiyoshi Matsuzaki using a soroban and Private Thomas Nathan Wood using an electric calculator. Matsuzaki won 4 out of 5 rounds. In addition, the abacus operator finished 10-digit addition in 1 minute 15 seconds while the calculator operator took 4 minutes. The abacus has zero boot time, zero power consumption, and infinite battery life.",
            question: "Modern computers are billions of times faster than the 1946 calculator. But could a soroban expert still beat a human using a smartphone? Why or why not?",
            era: "Post-War Japan"
        },
        {
            title: "The Inca Quipu: Computing Without Writing (1400s)",
            body: "The Inca Empire managed an economy of 10 million people without writing. Instead, they used quipus \u2014 knotted strings that encoded numbers in a base-10 positional system. A quipucamayoc (knot-keeper) could record harvests, census data, and taxes. Each string was a register, each knot position a digit \u2014 remarkably similar to the abacus rods you're clicking right now.",
            question: "The Inca had no written language but administered a vast empire with numbers alone. What does that tell us about the relationship between mathematics and power?",
            era: "Inca Empire"
        },
        {
            title: "Mental Abacus: Seeing Beads That Aren't There",
            body: "Champion abacus users develop 'anzan' \u2014 mental calculation by visualizing an imaginary abacus. Brain scans show they activate spatial regions, not the numerical regions used by most people. A skilled anzan practitioner can add fifteen 3-digit numbers in about 2 seconds, faster than typing them into a calculator. Children trained on the soroban consistently outperform peers in math tests.",
            question: "If visualizing an abacus makes you faster at math than using abstract numbers, what does that tell us about how the brain processes mathematics?",
            era: "Modern Japan"
        },
        {
            title: "Gerbert of Aurillac: The Pope Who Brought Numbers (999 AD)",
            body: "Before becoming Pope Sylvester II in 999, Gerbert studied in Islamic Spain where he encountered the Hindu-Arabic numeral system and the abacus. He brought both back to Christian Europe, which was still using Roman numerals. His mathematical knowledge was so advanced that medieval legends accused him of making a pact with the devil. In reality, he had simply studied under better teachers.",
            question: "Europe used Roman numerals for over a thousand years. Why is it so hard for a civilization to adopt a better number system?",
            era: "Medieval Europe"
        },
        {
            title: "Mesopotamian Clay Tokens: Before the Abacus (3400 BC)",
            body: "Before the abacus, Mesopotamian merchants used clay tokens sealed in hollow clay balls called 'bullae.' To avoid breaking the seal, they pressed token shapes into the outside surface \u2014 and accidentally invented writing. Cuneiform numerals evolved from these pressed tokens. Mathematics didn't just accompany the birth of civilization; it may have caused it.",
            question: "Writing was invented to keep track of numbers, not stories. Does that change how you think about what matters most to a civilization?",
            era: "Ancient Mesopotamia"
        }
    ],
    sliderule: [
        {
            title: "Apollo 11: Every NASA Engineer's Right Hand (1969)",
            body: "Every NASA engineer who worked on the Apollo program carried a slide rule. The Pickett N600-ES (a 6-inch aluminum model) was the standard issue. Buzz Aldrin carried one aboard Apollo 11 \u2014 it's now in the Smithsonian. The entire Saturn V rocket, the most complex machine ever built, was designed primarily with slide rules. An answer accurate to 3 significant figures was considered perfectly adequate.",
            question: "The Saturn V had 3 million parts. If each calculation was accurate to only 3 digits, how did they make the whole thing work?",
            era: "Space Race"
        },
        {
            title: "William Oughtred and the First Slide Rule (1622)",
            body: "Just 8 years after Napier published his logarithm tables, English clergyman William Oughtred realized he could put two logarithmic scales next to each other and multiply by sliding them. He created the first slide rule. For 350 years it was the most important computing tool in the world \u2014 used to design bridges, ships, aircraft, and nuclear reactors. The HP-35 killed it in 1972.",
            question: "The slide rule survived 350 years. The electronic calculator has lasted about 50. What tools do you think will replace calculators?",
            era: "Early Modern England"
        },
        {
            title: "The SR-71 Blackbird: Designed by Slide Rule (1962)",
            body: "Kelly Johnson's Skunk Works team at Lockheed designed the SR-71 Blackbird \u2014 an aircraft that flies at Mach 3.3 (2,200 mph) at 85,000 feet. The entire aircraft was designed using slide rules and drafting tables. At Mach 3, the airframe heats to 600\u00b0F, so they made it from titanium. Every stress calculation, every thermal expansion estimate, every fuel consumption curve was computed on a 10-inch slide rule.",
            question: "The SR-71 still holds speed records set in the 1970s. It was designed without computers. Does that surprise you? Why?",
            era: "Cold War"
        },
        {
            title: "Einstein's Gedankenexperiment: Thought Over Calculation",
            body: "Albert Einstein wasn't a great calculator. He famously said 'Do not worry about your difficulties in Mathematics. I can assure you mine are still greater.' His genius was in thought experiments (Gedankenexperimente) \u2014 imagining riding a beam of light, or falling in an elevator. The math came second. When he needed complex calculations for General Relativity, his friend Marcel Grossmann helped. Sometimes the insight matters more than the computation.",
            question: "Einstein imagined chasing a light beam at age 16. That thought experiment led to Special Relativity. What's a thought experiment you could try right now?",
            era: "Early 20th Century"
        },
        {
            title: "Isambard Kingdom Brunel: The Slide Rule Engineer (1840s)",
            body: "Brunel designed the Great Western Railway, the SS Great Britain (first iron-hulled, propeller-driven transatlantic steamship), and the Thames Tunnel. His calculations for structural stress, steam pressure, and hull strength were all done with a slide rule. He carried one in his coat pocket at all times. When the Great Eastern ship's launch failed in 1858, it wasn't the slide rule that was wrong \u2014 it was the hydraulic jacks.",
            question: "Brunel designed things that still stand today. Modern engineers use supercomputers. Are modern structures better designed? Are they more durable?",
            era: "Victorian Engineering"
        },
        {
            title: "The Logarithm: The Idea That Changed Everything (1614)",
            body: "John Napier spent 20 years computing logarithm tables. When Henry Briggs saw them, he traveled from London to Edinburgh just to meet Napier. Briggs reportedly stared at Napier for a quarter of an hour without speaking, then said: 'My Lord, I have undertaken this long journey purposely to see your person, and to know by what engine of wit or ingenuity you came first to think of this most excellent help.' The slide rule you're using is that engine.",
            question: "The red arrows below the scales show log(a) + log(b) = log(a\u00d7b). Why does turning multiplication into addition matter so much?",
            era: "Renaissance"
        }
    ],
    code: [
        {
            title: "Ada Lovelace's Note G: The First Program (1843)",
            body: "Ada Lovelace wrote the first computer program as a set of instructions for Charles Babbage's Analytical Engine. Her algorithm computed B\u2087, the 7th Bernoulli number (\u22121/30). She used variables V1\u2013V15, one operation per line, with loops and conditional branching \u2014 all the elements of a real program.<br><br>Her notation looks remarkably like assembly language: each step names a destination, an operation, and operands. The Church Machine's Symbolic Math compiler accepts her exact format: <code>let V4 = V2 * V3</code>. Click 'Ada: Note G' in the examples above to see it run.",
            question: "Ada's program had a bug. She wrote it by hand, with no debugger. How would you test a program if you had no computer to run it on?",
            era: "Victorian England, 1843"
        },
        {
            title: "Grace Hopper Invents the Compiler (1952)",
            body: "Grace Hopper was told that computers could only do arithmetic, not process language. She disagreed and built the first compiler (A-0) \u2014 a program that translated human-readable code into machine instructions. Nobody believed it would work. 'I had a running compiler and nobody would touch it,' she said. 'They told me a computer couldn\u2019t write a program.'<br><br>The CLOOMC++ compiler in the Church Machine follows the same idea: you write JavaScript, Haskell, or Ada's notation, and the compiler turns it into 32-bit Church Machine code words. Every 'Assemble' click is Hopper's invention at work.",
            question: "Before compilers, programmers wrote raw machine code by hand. Why was the idea of a computer writing code so hard for people to accept?",
            era: "Post-War America, 1952"
        },
        {
            title: "Capability Security: Dennis and Van Horn (1966)",
            body: "In 1966, Jack Dennis and Earl Van Horn published a paper at MIT describing a radical idea: instead of a central authority deciding who can access what (like a superuser), give each program unforgeable tokens called capabilities. If you hold the token, you can use the resource. If not, you can't even name it.<br><br>Every Golden Token in the Church Machine \u2014 the 32-bit values with Version, Index, Perms, and Type fields \u2014 is exactly what Dennis and Van Horn described. LOAD checks your token. CALL checks your token. No superuser, no branded operating systems, no surveillance, no bypass, no tricks, no hacking, no malware, no bullying, no cyber crime, and no ransomware.",
            question: "Most computers today use access control lists (who is allowed) instead of capabilities (what token do you hold). Which feels safer to you? Why?",
            era: "MIT, 1966"
        },
        {
            title: "Alonzo Church and the Lambda Calculus (1936)",
            body: "Before there were computers, Alonzo Church invented a complete model of computation using nothing but functions. He called it the lambda calculus. Every computation \u2014 adding numbers, sorting lists, running programs \u2014 can be expressed as functions applied to functions.<br><br>The Church Machine is named after him because it runs on his model, not the von Neumann model that every other computer uses. When you write Haskell code in this editor, you're writing in the language closest to what Church invented 90 years ago.",
            question: "Church proved that some problems can never be solved by any algorithm (the Entscheidungsproblem). Why would it matter to know that something is impossible?",
            era: "Princeton, 1936"
        },
        {
            title: "The Morris Worm: Why Security Matters (1988)",
            body: "On November 2, 1988, Robert Tappan Morris released a worm that crashed roughly 10% of the entire Internet (about 6,000 machines). It exploited a buffer overflow in the Unix 'finger' daemon \u2014 a bug where a program accepted more data than its buffer could hold, overwriting adjacent memory.<br><br>In the Church Machine, this attack is impossible. Every memory region is bounded by its Golden Token. The mLoad pipeline checks bounds at step 4. Writing past your allocation triggers a FAULT, not a takeover. The von Neumann design lets any gear touch any other gear. The Church Machine puts each gear in a sealed envelope.",
            question: "The Morris Worm was an accident \u2014 Morris didn't intend to crash the Internet. Should accidents be punished the same as intentional attacks?",
            era: "Early Internet, 1988"
        },
        {
            title: "Donald Knuth and The Art of Programming (1962\u2013present)",
            body: "Donald Knuth started writing 'The Art of Computer Programming' in 1962. He's still writing it. The work is so detailed that Knuth offers $2.56 (one hexadecimal dollar) to anyone who finds an error. Thousands of checks have been cashed.<br><br>Knuth also created TeX because he was unhappy with how his books were typeset. Rather than complain, he built the entire typesetting system himself. The Church Machine follows the same philosophy: if the existing design (von Neumann) has a flaw (no security), don't patch it \u2014 build the right thing.",
            question: "Knuth says 'premature optimization is the root of all evil.' What does that mean for how you should write code?",
            era: "Stanford, 1962\u2013present"
        },
        {
            title: "Haskell: A Language for Mathematicians (1990)",
            body: "In 1987, a group of academics were frustrated: there were too many lazy functional languages, each slightly different. They formed a committee and in 1990 released Haskell, named after Haskell Curry (who also studied under Church). Haskell is purely functional \u2014 no side effects, no mutable state.<br><br>The Church Machine's Haskell front-end compiles lambda expressions, case statements, and pairs directly to the 20-instruction set. When you click 'HS: Math' or 'HS: Lambda' above, you're writing in a language designed by Church's intellectual grandchildren.",
            question: "Haskell has no mutable variables \u2014 once you set a value, it can never change. How would you write a counter without being able to change a variable?",
            era: "Academic Computing, 1990"
        },
        {
            title: "The Therac-25: When Software Kills (1985\u20131987)",
            body: "The Therac-25 was a radiation therapy machine. Software bugs caused it to deliver 100 times the intended dose, killing three patients and injuring three more. The root cause: race conditions and the removal of hardware safety interlocks in favour of software-only checks.<br><br>In capability security, the principle of least authority (POLA) means each component holds only the permissions it needs. If the Therac-25 had used capabilities, the high-energy beam control would have been isolated behind a separate token with its own safety checks \u2014 no single bug could have bypassed all protections.",
            question: "The Therac-25 accidents happened because testers never tested unusual input sequences. How would you test software that controls something dangerous?",
            era: "Medical Computing, 1985"
        },
        {
            title: "Create Abstraction: Where Mind Meets Body",
            body: "An abstraction is the Church Machine's open-ended programming language of the <strong>Mind</strong>. When you write code in this editor \u2014 whether JavaScript, Haskell, or Ada's notation \u2014 you are describing an idea: what methods it has, what it can do, what capabilities it holds. This is pure thought. It exists in the Church domain \u2014 the world of symbols, permissions, and Golden Tokens.<br><br>But an idea in the Mind is not yet real. It has no memory, no namespace entry, no token that other programs can use to reach it. It is a blueprint without a building.<br><br>The <strong>Create Abstraction</strong> button is the moment Mind becomes Body. It takes your idea and gives it physical form: a lump of memory in the Turing domain (code region CR7 + capability list CR6), a namespace entry with three words of state, and a Golden Token (E-GT) so the rest of the system can call it. Navana \u2014 the master controller \u2014 writes these entries. No one else can.<br><br>This is what makes the Church Machine different from every other computer. On a von Neumann machine, code and data live in the same flat space with no protection. On the Church Machine, every abstraction is a sealed security block. The Mind designs it. The Body protects it. The Golden Token is the only key.",
            question: "When you write an abstraction, you choose its methods and capabilities. Once you click Create Abstraction, those choices become permanent and protected. Why might it be important that you cannot change the permissions after creation?",
            era: "Church Machine Design"
        }
    ]
};

const CODE_EXAMPLE_STORIES = {
    'ada_note_g': {
        title: "Ada's Note G \u2014 The First Program (1843)",
        body: "You're looking at the first computer program ever written. Ada Lovelace designed this algorithm to compute B\u2087, the 7th Bernoulli number (\u22121/30), for Babbage's Analytical Engine \u2014 a machine that was never built.<br><br>Her variables V1\u2013V15 map directly to the Church Machine's data registers DR1\u2013DR15. Each line is one operation: <code>let V4 = V2 * V3</code> means multiply V2 by V3, store in V4. The program loops, accumulating terms until the answer appears.<br><br>Click <strong>Assemble</strong> to compile it, then use <strong>Step</strong> to watch each instruction execute. The Console Output tab shows the compiled code words. The result should be \u22121/30.",
        question: "Ada's original had a small bug. Can you spot anything that looks wrong in the code? What would happen if a loop counter started at the wrong value?",
        era: "Victorian England, 1843"
    },
    'hello': {
        title: "Hello World \u2014 The Simplest Abstraction",
        body: "Every programmer's first program says hello. This one creates an abstraction called Hello with a single method: Greet. It takes a value, adds 1, and returns the result.<br><br>In Church Machine terms, this is a complete security block: it gets its own namespace entry, its own Golden Token, and its own sealed code region (CR7). Even this tiny program is protected by capability security.<br><br>Click <strong>Assemble</strong> to compile, then switch to the Console Output tab to see the generated code words.",
        question: "This abstraction only has one method. What would happen if you tried to call a method that doesn't exist?",
        era: "The Beginning"
    },
    'memory': {
        title: "Memory Management \u2014 No Malloc, No Free, No Bugs",
        body: "On a von Neumann machine, memory allocation is the source of countless security holes: buffer overflows, use-after-free, double-free. The Church Machine's Memory abstraction (NS[8]) handles allocation through capability-controlled methods.<br><br>Allocate asks for a size, rounds up to a power of 2 (minimum 32 words), and returns a bounded region. The Golden Token for that region encodes exact bounds \u2014 you physically cannot read or write outside them.",
        question: "Why does the Church Machine round allocations up to powers of 2? What advantage does that give the hardware?",
        era: "System Design"
    },
    'counter': {
        title: "Counter \u2014 Two Methods, One Abstraction",
        body: "This Counter abstraction has two methods: Increment (add 1) and Add (add two values). In JavaScript syntax, it looks like a simple object \u2014 but the compiler turns it into a Church Machine abstraction with a method table, code region, and c-list.<br><br>Each method compiles to a sequence of IADD instructions. The calling convention puts arguments in DR0\u2013DR3 and the return value in DR0.",
        question: "The Counter has no internal state \u2014 it just computes and returns. How would you add persistent state that survives between calls?",
        era: "Programming Fundamentals"
    },
    'church_math': {
        title: "Church Numerals \u2014 Numbers as Functions (1936)",
        body: "Alonzo Church showed that numbers don't need to be primitive \u2014 they can be built from pure functions. The number 3 is 'apply f three times': \u03bbf.\u03bbx.f(f(f(x))). Addition is composing applications. Multiplication is composing compositions.<br><br>This Haskell example compiles successor, add, multiply, predecessor, and isZero to Church Machine instructions. The <code>--</code> comments are Haskell-style. Click <strong>Assemble</strong> to see how abstract mathematics becomes concrete machine code.",
        question: "If zero is \u03bbf.\u03bbx.x (apply f zero times), what is the predecessor of zero? Can you have negative Church numerals?",
        era: "Princeton, 1936"
    },
    'church_pair': {
        title: "Church Pairs \u2014 Data Structures from Nothing",
        body: "A pair packs two values into one. Church showed this can be done with pure functions: PAIR = \u03bba.\u03bbb.\u03bbf.f(a)(b). To get the first element, pass a selector that picks the first argument.<br><br>The Church Machine implements pairs by packing two 16-bit values into one 32-bit word using BFINS and BFEXT (bit field insert/extract). The Haskell front-end compiles <code>fst</code> and <code>snd</code> into these bit operations.",
        question: "If you can make pairs, you can make lists (a pair of value and rest-of-list). How would you build a list of three numbers using only pairs?",
        era: "Lambda Calculus"
    },
    'church_case': {
        title: "Pattern Matching \u2014 Case Expressions",
        body: "Haskell's case expressions let you match a value against patterns: case n of 0 \u2192 1, _ \u2192 n * (n-1). The compiler turns each pattern into an MCMP (compare) followed by a conditional BRANCH.<br><br>This example implements factorial, classification, and absolute value. Each case arm becomes a compare-and-jump chain in the generated code \u2014 exactly how a hardware switch statement works.",
        question: "The factorial case says 0 \u2192 1 and _ \u2192 n * (n-1). But n * (n-1) isn't recursive here. What would real recursion look like?",
        era: "Functional Programming"
    },
    'church_lambda': {
        title: "Lambda Expressions \u2014 Functions as Values",
        body: "Lambda expressions are the core of Church's invention: anonymous functions that can be passed around, returned, and composed. The identity function \u03bbx.x just returns its argument. The constant function \u03bbx.\u03bby.x ignores the second argument.<br><br>The <code>let a = x + 1 in a + a</code> example shows let-binding: compute a value, name it, use it twice. The compiler allocates a register for 'a' and emits two references to it.",
        question: "The constant function ignores its second argument. When would that be useful? Can you think of a real-world situation where you'd want to ignore information?",
        era: "Lambda Calculus"
    },
    'perm_attack': {
        title: "Permission Attack \u2014 Testing Security",
        body: "This example deliberately tries to break the rules: it attempts operations that the Golden Token doesn't permit. On a von Neumann machine, these attacks often succeed because there's no hardware enforcement.<br><br>On the Church Machine, every LOAD checks permissions at pipeline step 5. If your token says X-only (execute), you cannot read or write. The attack triggers a FAULT, not a compromise. Try stepping through to see exactly where each attack fails.",
        question: "If you were designing a security system, would you rather have attacks fail silently or trigger a visible alarm? Why?",
        era: "Security Testing"
    },
    'bind_attack': {
        title: "Bind Attack \u2014 The B-bit Defence",
        body: "The bind attack tries to re-bind a Golden Token to point at a different memory region \u2014 essentially stealing someone else's data by redirecting your own token. The B (Bind) bit in the NS entry prevents this: once cleared by CALL, the binding is locked.<br><br>Step through this code and watch the FAULT trigger when the attacker tries to change the token's target. This is R001 in the security risk register.",
        question: "Physical keys can be copied. Digital keys (Golden Tokens) cannot because of the version counter. Which is actually more secure?",
        era: "Security Testing"
    },
    'salvation': {
        title: "Salvation \u2014 The Boot Abstraction",
        body: "Salvation (NS[4]) is the first abstraction that runs when the Church Machine starts. It sets up the initial namespace entries, creates the Navana controller, and then transfers control permanently \u2014 Navana runs forever, never returning.<br><br>This is like a rocket booster: it gets the system to altitude, then detaches. After Salvation hands off to Navana, it can never be called again. The boot sequence is: Boot \u2192 CALL Salvation \u2192 Salvation transitions to Navana \u2192 Navana runs forever.",
        question: "Why would you design a boot process that destroys itself after running? What security advantage does that give?",
        era: "System Architecture"
    },
    'gc_test': {
        title: "Garbage Collection \u2014 Automated Memory Safety",
        body: "The GC abstraction (NS[44]) reclaims memory that is no longer reachable. Unlike C's manual free() or Java's stop-the-world collector, the Church Machine's GC works within the capability system \u2014 it can only reclaim regions whose tokens have been revoked.<br><br>This test creates allocations, revokes their tokens, and verifies the GC reclaims them correctly. Step through to see the lifecycle.",
        question: "Some languages (Rust) use compile-time ownership instead of garbage collection. What are the trade-offs between checking at compile time versus at runtime?",
        era: "Memory Management"
    },
    'turing_test': {
        title: "Turing ISA \u2014 The Body's Instructions",
        body: "The Turing domain has 10 instructions for computation: DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR. These are 'the body' \u2014 they work with numbers, addresses, and registers. They can overflow, underflow, and loop forever.<br><br>This test exercises each Turing instruction. Step through and watch DR registers change in the state panel. Compare with Church domain instructions (LOAD, SAVE, CALL) that work with tokens and permissions instead.",
        question: "Turing instructions can fail (overflow, divide by zero, infinite loops). Church instructions can FAULT (bad token, wrong permissions). What's the difference between a failure and a fault?",
        era: "Instruction Architecture"
    },
    'sliderule': {
        title: "SlideRule in JavaScript \u2014 Math Without Multiply",
        body: "The Church Machine has no multiply or divide instruction. This SlideRule abstraction implements multiplication using shift-and-add (the same algorithm a child uses for long multiplication in binary), and division using repeated subtraction.<br><br>The Sqrt method uses Newton's method: guess, divide, average, repeat. All built from IADD, ISUB, SHL, and SHR. Click <strong>Assemble</strong>, then step through Mul to watch binary multiplication happen one bit at a time.",
        question: "Early computers also lacked multiply instructions. The ENIAC (1945) multiplied by repeated addition. Why would a chip designer leave out multiply? What's the trade-off?",
        era: "Algorithm Design"
    },
    'sliderule_hs': {
        title: "SlideRule in Haskell \u2014 Same Machine, Different Mind",
        body: "This is the same SlideRule abstraction, but written in Haskell instead of JavaScript. Both compile to exactly the same 20-instruction Church Machine code. That's the point of a universal target \u2014 the language you think in doesn't change what the hardware runs.<br><br>Compare this with the JS version (click 'JS: SlideRule'). The Haskell version is more concise: <code>method Add(a, b) = a + b</code> versus a block with explicit return. Different syntax, identical output.",
        question: "If two languages compile to identical machine code, does the choice of language matter? What does each language make easier or harder to think about?",
        era: "Universal Target"
    }
};

const LANGUAGE_STORIES = {
    english: {
        title: "English — Programming in Your Own Words",
        body: "<strong>The idea:</strong> What if you could tell a computer what to do in plain English? The Church Machine's English front-end makes this real. You write sentences, and the compiler translates them into the same 32-bit machine instructions as JavaScript, Haskell, or Ada's notation.<br><br>" +
            "<strong>How it works:</strong> The compiler reads your sentences and matches patterns. It understands verbs like <em>create</em>, <em>set</em>, <em>return</em>, <em>call</em>, and <em>if/when</em>. Nouns become variable names. Phrases like <em>plus</em>, <em>minus</em>, <em>times</em>, and <em>divided by</em> become arithmetic.<br><br>" +
            "<strong>Syntax patterns:</strong><br>" +
            "<code>Create an abstraction called Hello</code> — declares the abstraction<br>" +
            "<code>Add a method called Greet that takes who</code> — defines a method with parameters<br>" +
            "<code>It needs Memory and Mint</code> — declares capability requirements<br>" +
            "<code>Set result to x plus 1</code> — assignment with arithmetic<br>" +
            "<code>Let total be a plus b</code> — alternative assignment syntax<br>" +
            "<code>If count is greater than 0</code> — conditional (also: <em>is equal to</em>, <em>is less than</em>, <em>is not</em>)<br>" +
            "<code>Otherwise</code> — else branch<br>" +
            "<code>End if</code> — closes the conditional<br>" +
            "<code>Call Memory.Allocate with size</code> — invokes another abstraction's method<br>" +
            "<code>Set r to the result of calling Memory.Allocate with size</code> — captures return value<br>" +
            "<code>Return the result</code> — sends the value back<br><br>" +
            "<strong>Why English matters:</strong> Grace Hopper fought for the idea that programming should be accessible. She was told computers could only understand numbers. She proved everyone wrong by inventing the compiler in 1952. The English front-end carries her vision to its logical conclusion: if the machine can understand JavaScript, Haskell, and Ada's notation, why not the language you already speak?<br><br>" +
            "<strong>Auto-detection:</strong> The compiler detects English from your sentence patterns. You can also select it from the language dropdown. Both EN examples (Hello and Counter) demonstrate the core patterns.",
        question: "The English front-end compiles to the same machine code as JavaScript. If they produce identical output, is English 'really' a programming language? What makes something a programming language?",
        era: "Grace Hopper's Dream, 1952 → Now"
    },
    javascript: {
        title: "JavaScript — The Language of the Web",
        body: "<strong>The idea:</strong> The Church Machine's JavaScript front-end uses a C-like syntax familiar to millions of programmers. Curly braces define blocks. Equals assigns values. Parentheses group arguments. If you've ever written any code, this will feel like home.<br><br>" +
            "<strong>How it works:</strong> The compiler parses an <code>abstraction Name { }</code> block containing <code>capabilities { }</code> and <code>method Name(args) { }</code> sections. Each method body contains statements that compile one-to-one with the Church Machine's 20-instruction set.<br><br>" +
            "<strong>Syntax patterns:</strong><br>" +
            "<code>abstraction Counter {</code> — declares the abstraction<br>" +
            "<code>capabilities { Memory }</code> — lists required capabilities for the c-list<br>" +
            "<code>method Add(a, b) {</code> — defines a method with parameters<br>" +
            "<code>result = a + b</code> — assignment (operators: <code>+</code>, <code>-</code>, <code>&lt;&lt;</code>, <code>&gt;&gt;</code>)<br>" +
            "<code>x = read(CR7, 0)</code> — reads from capability-bounded memory<br>" +
            "<code>write(CR7, 0, value)</code> — writes to capability-bounded memory<br>" +
            "<code>result = call(Memory.Allocate(size))</code> — calls another abstraction via c-list<br>" +
            "<code>if (a == b) { ... }</code> — conditional (operators: <code>==</code>, <code>!=</code>, <code>&lt;</code>, <code>&gt;</code>, <code>&lt;=</code>, <code>&gt;=</code>)<br>" +
            "<code>while (i &lt; 10) { ... }</code> — loop<br>" +
            "<code>return(result)</code> — returns value in DR0<br>" +
            "<code>bfext(word, pos, width)</code> — extracts a bit field<br>" +
            "<code>bfins(word, val, pos, width)</code> — inserts a bit field<br><br>" +
            "<strong>Calling convention:</strong> DR0–DR3 hold arguments and return values. DR4–DR11 are local variables (callee-saved). DR12–DR15 are temporaries (caller-saved). CR7 points to the code region, CR6 to the c-list.<br><br>" +
            "<strong>History:</strong> Brendan Eich created JavaScript in 10 days in 1995. It was designed as a simple scripting language for web browsers, but it became the most widely used programming language in history. The Church Machine's JS front-end proves that even a language designed for web pages can target security-hardened capability hardware.",
        question: "JavaScript was created in 10 days. The Church Machine was designed over years. Does the time spent designing a language affect how safe or powerful it is?",
        era: "Netscape, 1995"
    },
    haskell: {
        title: "Haskell — Pure Functions, No Side Effects",
        body: "<strong>The idea:</strong> Haskell is a purely functional language. Every function takes inputs and produces outputs — nothing else. No global variables, no hidden state changes, no surprises. This makes programs easier to reason about, test, and verify.<br><br>" +
            "<strong>How it works:</strong> The Haskell front-end compiles lambda expressions, case statements, let-bindings, and pairs into Church Machine instructions. Each method is a single expression: <code>method Add(a, b) = a + b</code>.<br><br>" +
            "<strong>Syntax patterns:</strong><br>" +
            "<code>method successor(n) = n + 1</code> — method as a single expression<br>" +
            "<code>method abs(n) = if n &lt; 0 then 0 - n else n</code> — inline conditional<br>" +
            "<code>method factorial(n) = case n of 0 -&gt; 1, _ -&gt; n * (n - 1)</code> — pattern matching<br>" +
            "<code>method letExample(x) = let a = x + 1 in a + a</code> — let-binding<br>" +
            "<code>method first(p) = fst p</code> — pair first element (BFEXT)<br>" +
            "<code>method second(p) = snd p</code> — pair second element (BFEXT)<br>" +
            "<code>method makePair(a, b) = (a, b)</code> — pair construction (BFINS)<br>" +
            "<code>\\x -&gt; x + 1</code> — lambda expression (compiles to LAMBDA instruction)<br><br>" +
            "<strong>Why Haskell on Church Machine?</strong> The Church Machine is named after Alonzo Church, who invented the lambda calculus. Haskell is the language closest to Church's original formalism. The Haskell front-end proves that the Church Machine truly runs on lambda calculus, not just a dressed-up von Neumann architecture.<br><br>" +
            "<strong>History:</strong> Haskell was designed in 1990 by a committee of academics, named after Haskell Curry — who, like Turing, studied under Alonzo Church. Curry discovered that any function with multiple arguments can be rewritten as a chain of single-argument functions (currying). The 'Church → Curry → Haskell' lineage is a direct family tree of ideas.",
        question: "Haskell has no mutable variables — once you set a value, it can never change. If nothing can change, how does a Haskell program do anything useful? How is state managed?",
        era: "Church → Curry → Haskell, 1936–1990"
    },
    symbolic: {
        title: "Symbolic Math — Ada Lovelace's Notation (1843)",
        body: "<strong>The idea:</strong> In 1843, Ada Lovelace wrote the first computer program using a notation of variables (V1, V2, ...) and operations (one per line). She was describing an algorithm for Charles Babbage's Analytical Engine — a mechanical computer that was never built. The Church Machine's Symbolic Math front-end uses her exact notation, 180 years later.<br><br>" +
            "<strong>How it works:</strong> The compiler recognises Ada-style variable patterns (V1–V15), arrow assignments (→), and operation keywords. Each variable maps directly to a data register: V1 → DR1, V2 → DR2, and so on, up to V15 → DR15.<br><br>" +
            "<strong>Syntax patterns:</strong><br>" +
            "<code>let V1 = 1</code> — initialise a store column<br>" +
            "<code>let V4 = V2 * V3</code> — multiply (compiled to shift-and-add loop)<br>" +
            "<code>let V11 = V4 / V5</code> — divide (compiled to repeated subtraction)<br>" +
            "<code>let V5 = V5 + V1</code> — addition<br>" +
            "<code>let V4 = V4 - V1</code> — subtraction<br>" +
            "<code>V2 × V3 → V4</code> — arrow notation (Ada's original style)<br><br>" +
            "<strong>No multiply or divide instructions:</strong> The Church Machine has no hardware multiply or divide. The symbolic math compiler generates software routines using IADD, ISUB, SHL, and SHR — the same approach Ada would have used, since Babbage's Engine also lacked these instructions.<br><br>" +
            "<strong>Note G:</strong> Ada's most famous program computes B₇, the 7th Bernoulli number (−1/30). It uses variables V1–V15, 25 operations, and a loop. Click 'Ada: Note G' in the examples to run it. The result should be −1/30 — if it isn't, you've found the same bug Ada had.<br><br>" +
            "<strong>Why Ada matters:</strong> Ada saw something nobody else did: Babbage's Engine could manipulate <em>symbols</em>, not just numbers. She wrote: 'The Engine might compose elaborate and scientific pieces of music of any degree of complexity or extent.' She imagined general-purpose computing 100 years before it existed. The Church Machine honours her by running her notation natively.",
        question: "Ada wrote her program for a machine that didn't exist yet. She was programming an imaginary computer. Is that different from what we do when we write code for a simulator?",
        era: "Victorian England, 1843"
    },
    assembly: {
        title: "Assembly — Speaking Directly to the Machine",
        body: "<strong>The idea:</strong> Assembly language is as close to the hardware as you can get. Each line corresponds to exactly one machine instruction. There is no compiler, no abstraction, no hiding — you see every register move, every memory access, every branch.<br><br>" +
            "<strong>The Church Machine has 20 instructions</strong> split between two domains:<br><br>" +
            "<strong>Church Domain (Mind — capabilities):</strong><br>" +
            "<code>LOAD CRd, [CRs, idx]</code> — load a Golden Token from memory<br>" +
            "<code>SAVE [CRd, idx], CRs</code> — save a Golden Token to memory<br>" +
            "<code>CALL CRd</code> — enter an abstraction (checks E permission, clears B-bit)<br>" +
            "<code>RETURN</code> — return from the current abstraction<br>" +
            "<code>SEAL CRd, CRs</code> — seal a token (lock its permissions)<br>" +
            "<code>UNSEAL CRd, CRs</code> — unseal a token (requires S permission)<br>" +
            "<code>REVOKE idx</code> — revoke a token (increments version)<br>" +
            "<code>LAMBDA CRd, offset</code> — capture a closure<br>" +
            "<code>CMPSWP CRd, CRs, CRt</code> — atomic compare-and-swap for tokens<br>" +
            "<code>MINT CRd, perms</code> — create a new token with specified permissions<br><br>" +
            "<strong>Turing Domain (Body — data):</strong><br>" +
            "<code>DREAD DRd, [CRs, offset]</code> — read data from bounded memory<br>" +
            "<code>DWRITE [CRd, offset], DRs</code> — write data to bounded memory<br>" +
            "<code>IADD DRd, DRs, imm</code> — integer add<br>" +
            "<code>ISUB DRd, DRs, imm</code> — integer subtract<br>" +
            "<code>SHL DRd, DRs, imm</code> — shift left<br>" +
            "<code>SHR DRd, DRs, imm</code> — shift right<br>" +
            "<code>BFEXT DRd, DRs, pos, width</code> — bit field extract<br>" +
            "<code>BFINS DRd, DRs, pos, width</code> — bit field insert<br>" +
            "<code>MCMP DRa, DRb</code> — compare and set flags<br>" +
            "<code>BRANCH cond, target</code> — conditional branch (AL, EQ, NE, LT, GE, GT, LE)<br><br>" +
            "<strong>Conditional execution:</strong> Every instruction supports ARM-style condition codes. The 4-bit condition field means any instruction can be skipped based on the last compare: <code>IADD.EQ</code> only adds if the previous MCMP found equality.<br><br>" +
            "<strong>Why assembly?</strong> When something goes wrong — a security fault, a capability violation, a bad branch — assembly is where you find the truth. The compiler output shows you hexadecimal code words. Step mode lets you execute one instruction at a time. Assembly is the language the machine actually speaks.",
        question: "Assembly has no variables, no functions, no abstractions — just registers and memory. Yet it can do everything the other four languages can. What exactly do higher-level languages add, if the machine doesn't need them?",
        era: "The Hardware Level"
    }
};

const CODE_STEP_GUIDE = {
    title: "How to Step Through Your Code",
    body: "<strong>1. Write or load code</strong> \u2014 Type in the editor or click an example tab above (Hello, Memory, Ada: Note G, etc.).<br><br>" +
        "<strong>2. Click Assemble</strong> \u2014 The compiler turns your source into 32-bit Church Machine code words. Switch to <strong>Console Output</strong> to see the compiled instructions and any errors.<br><br>" +
        "<strong>3. Click Step</strong> (top right) \u2014 Executes one instruction at a time. Each step updates the registers, namespace, and pipeline state. Watch the Pipeline tab to see the 7-stage mLoad process.<br><br>" +
        "<strong>4. Click Run</strong> \u2014 Executes all instructions until the program halts or faults. Results appear in Console Output.<br><br>" +
        "<strong>5. Click Reset</strong> \u2014 Clears the machine state back to zero so you can run again.<br><br>" +
        "<strong>Try it now:</strong> Load an example, click Assemble, switch to Console Output, then click Step repeatedly to watch each instruction execute. The gold text shows Church domain operations (capabilities, tokens), the blue text shows Turing domain operations (numbers, registers).",
    question: "When you step through code, you see exactly what the machine does at each moment. Real processors execute billions of steps per second. What gets lost when things go that fast?",
    era: "Learning Guide"
};

let historyCurrentTool = 'interactive';
let historyCurrentCodeExample = null;
let historyShownIndices = { interactive: [], hp35: [], abacus: [], sliderule: [], code: [] };

function historyGetRandom(tool) {
    const stories = MATH_HISTORY[tool];
    if (!stories || stories.length === 0) return null;

    if (historyShownIndices[tool].length >= stories.length) {
        historyShownIndices[tool] = [];
    }

    let available = [];
    for (let i = 0; i < stories.length; i++) {
        if (historyShownIndices[tool].indexOf(i) === -1) available.push(i);
    }

    const pick = available[Math.floor(Math.random() * available.length)];
    historyShownIndices[tool].push(pick);
    return stories[pick];
}

function historySetTool(tool) {
    historyCurrentTool = tool;
    historyRefresh();
}

function historyRenderStory(area, tool) {
    const story = historyGetRandom(tool);
    if (!story) {
        area.innerHTML = '<div class="history-empty">No stories available.</div>';
        return;
    }

    area.innerHTML = `
        <div class="history-story">
            <div class="history-era">${story.era}</div>
            <div class="history-title">${story.title}</div>
            <div class="history-body">${story.body}</div>
            <div class="history-question">
                <div class="history-question-label">Think about it</div>
                ${story.question}
            </div>
        </div>
    `;
}

function historyRefresh() {
    const area = document.getElementById('historyContent');
    if (area) historyRenderStory(area, historyCurrentTool);
}

function historyRefreshCode() {
    const area = document.getElementById('codeHistoryContent');
    if (!area) return;

    if (historyCurrentCodeExample && CODE_EXAMPLE_STORIES[historyCurrentCodeExample]) {
        const story = CODE_EXAMPLE_STORIES[historyCurrentCodeExample];
        area.innerHTML = `
            <div class="history-story">
                <div class="history-era">${story.era}</div>
                <div class="history-title">${story.title}</div>
                <div class="history-body">${story.body}</div>
                <div class="history-question">
                    <div class="history-question-label">Think about it</div>
                    ${story.question}
                </div>
            </div>
        `;
    } else {
        historyRenderStory(area, 'code');
    }
}

function historySetCodeExample(name) {
    historyCurrentCodeExample = name;
    const panel = document.getElementById('codeHistoryPanel');
    if (panel && panel.style.display !== 'none') {
        historyRefreshCode();
    }
}

function historyShowStepGuide() {
    const area = document.getElementById('codeHistoryContent');
    if (!area) return;
    area.innerHTML = `
        <div class="history-story">
            <div class="history-era">${CODE_STEP_GUIDE.era}</div>
            <div class="history-title">${CODE_STEP_GUIDE.title}</div>
            <div class="history-body">${CODE_STEP_GUIDE.body}</div>
            <div class="history-question">
                <div class="history-question-label">Think about it</div>
                ${CODE_STEP_GUIDE.question}
            </div>
        </div>
    `;
}

function historyNewStory() {
    historyRefresh();
}

function historyNewCodeStory() {
    historyRefreshCode();
}

function historyShowLanguageStory(lang) {
    const story = LANGUAGE_STORIES[lang];
    if (!story) return;
    const area = document.getElementById('codeHistoryContent');
    if (!area) return;
    area.innerHTML = `
        <div class="history-story">
            <div class="history-era">${story.era}</div>
            <div class="history-title">${story.title}</div>
            <div class="history-body">${story.body}</div>
            <div class="history-question">
                <div class="history-question-label">Think about it</div>
                ${story.question}
            </div>
        </div>
    `;
    switchCodeTab('history');
}

function historyShowCreateAbstraction() {
    const story = MATH_HISTORY.code.find(s => s.title === "Create Abstraction: Where Mind Meets Body");
    if (!story) return;
    const area = document.getElementById('codeHistoryContent');
    if (!area) return;
    area.innerHTML = `
        <div class="history-story">
            <div class="history-era">${story.era}</div>
            <div class="history-title">${story.title}</div>
            <div class="history-body">${story.body}</div>
            <div class="history-question">
                <div class="history-question-label">Think about it</div>
                ${story.question}
            </div>
        </div>
    `;
    switchCodeTab('history');
}
