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
    ]
};

let historyCurrentTool = 'interactive';
let historyShownIndices = { interactive: [], hp35: [], abacus: [], sliderule: [] };

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

function historyRefresh() {
    const area = document.getElementById('historyContent');
    if (!area) return;

    const story = historyGetRandom(historyCurrentTool);
    if (!story) {
        area.innerHTML = '<div class="history-empty">Select a math tool to see its history.</div>';
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

function historyNewStory() {
    historyRefresh();
}
