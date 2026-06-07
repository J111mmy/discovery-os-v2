# A Better Model for Evidence, Themes, and Problems in Software Research

## My judgement

I would **not** ship the model exactly as written. I think it is **directionally right** about two things: first, a single evidence snippet can absolutely carry multiple labels; second, a problem should retain a traceable link back to the evidence that supports it. But I think the model becomes methodologically muddy because it uses the word **theme** for what are, in most research traditions and in much of today’s software market, really **codes, topics, or tags** attached to snippets. In qualitative methods, a theme is usually a **higher-order pattern of shared meaning** organised around a central organising concept, whereas codes are the more specific labels attached to segments of data. Braun and Clarke make that distinction explicitly, and Productboard now does something very similar in product tooling by separating **themes** as broad strategic categories from **topics** as more granular AI-generated clusters and **tags** as flexible labels. citeturn27view0turn27view1turn26view1

So my answer is: **I agree with the mechanics, but not with the terminology or with the implied data model.** Your instinct that there may need to be another layer is sound. The better design is usually **evidence → code/topic/tag → optional subcategory or subtheme → theme → problem**, with direct traceability from problems back to evidence. citeturn31view0turn31view1turn26view1turn27view8

## What the current model gets right

Your description is right to treat evidence as **multi-label**. Applied qualitative analysis tools explicitly support this. Dovetail states that a single highlight can have **one or many tags**, and Qualtrics allows a response to carry multiple topics. In recent qualitative-methods literature, the same data can also legitimately appear in multiple codes, because overlap often reflects the complexity of real-world qualitative material rather than a mistake. citeturn26view6turn32view0turn31view1

Your description is also right to value **provenance**. Good research systems should let people move from a synthesised statement back to the source evidence. Dovetail emphasises that highlights can be grouped and shared in insights to connect findings back to raw data, and that every AI-generated insight links back to its source. Condens similarly positions evidence-backed findings and traceable insight libraries as a core part of credible analysis. This is not just a software nicety; it aligns with the broader qualitative-research idea of an audit trail, where decisions and interpretations should be traceable back to the underlying material. citeturn27view8turn26view2turn33view0turn31view3turn23search22

Finally, your description is right that a problem can still be **one discrete problem** even when the evidence touches several areas. In UX and product discovery, a problem statement is a concise description of what needs to be solved; it is not invalidated because its causes or manifestations cut across more than one topic area. citeturn26view8turn19view8

## Where the model breaks down

The biggest issue is that the sentence-level labels in your example—“onboarding friction”, “pricing confusion”, “API reliability”—look much more like **topics/codes** than fully realised themes. Braun and Clarke explicitly warn against confusing **topic summaries** with themes. A topic summary simply gathers everything said about an area; a theme, by contrast, is a patterned meaning organised by a central concept. If your AI is attaching labels to individual snippets, it is almost always doing **code/topic assignment**, not full theme construction. citeturn27view1turn27view2turn27view3

This matters because if you call snippet-level labels “themes”, you collapse at least two distinct analytical jobs into one: **descriptive sorting** and **interpretive synthesis**. In practice, the market is increasingly separating these layers rather than merging them. Productboard’s model is especially telling here: **themes** are the broad strategic “forest” view, **topics** are granular AI-generated clusters inside those themes, and **tags** remain flexible labels. Qualtrics similarly talks about topics and topic hierarchies rather than calling every snippet label a theme. citeturn26view1turn19view10turn26view4

The second problem is the idea that a problem can simply **inherit** all theme labels from its evidence and that this is enough. As a provenance mechanism, that is useful. As a meaning system, it is too blunt. A union of inherited labels tells you what supporting evidence touched, but not what the problem is **primarily about**. If five snippets support a problem and together they mention setup, permissions, pricing, procurement, and training, inheritance alone will make the problem look semantically messy even if the real issue is something cleaner like “buyers cannot confidently begin implementation”. That difference between a pattern and an actionable problem statement is exactly why research practice separates raw data, findings, and insights. NN/g defines findings as patterns among data points and insights as the interpretation that explains those patterns and identifies action. citeturn26view7turn26view8turn26view9

## Whether you need subthemes

Your instinct about “another level” is good, but with an important caveat: **you do not always need a subtheme layer, and when you do, it may be better called a subcategory or parent topic rather than a subtheme**. Braun and Clarke say subthemes should be used **sparingly**, only when a particular element of a theme deserves special salience and still shares the same central organising concept as the parent theme. citeturn27view2

However, software for large-scale customer feedback and research repositories often benefits from hierarchy for a different reason: **navigation, governance, and scalability**. Qualtrics supports topic hierarchies of up to five levels. MAXQDA supports hierarchical code systems up to ten levels. Productboard explicitly supports nesting and a layered structure of themes, topics, and tags. In other words, the market has already answered your question: at scale, hierarchical organisation is common because it helps teams manage complexity. citeturn26view4turn26view5turn21view0

So the research-backed answer is not “there must always be subthemes”. It is this:

**If the extra layer reflects a true shared organising concept, call it a subtheme. If it is mainly a practical grouping layer for sorting and governance, call it a category, parent topic, or subcategory.**

That distinction keeps your terminology honest while still giving your product the flexibility it probably needs. Qualitative content-analysis approaches often use exactly this kind of three-strata structure—codes, subcategories, categories—with increasing abstraction as you move up. More recent work also describes codes, subcategories, and categories as a continuum of abstraction, with themes reserved for deeper interpretive work. citeturn31view0turn31view1turn31view2

## How problems should relate to themes

My view is that **problems and themes are related, but they are not the same kind of object**. A theme organises recurring meaning or at least recurring topical material. A problem statement describes something that is getting in the user’s way and needs to be solved. NN/g defines a problem statement as a concise description of the problem to be solved, while GOV.UK guidance on user needs stresses focusing on the user’s problem and desired outcome rather than prematurely solutionising. citeturn26view8turn19view7turn19view8

That means themes should not define problems by inheritance alone. Instead, I would model the relation as a **typed many-to-many relationship**:

A problem should have a **primary theme** that best classifies it for reporting and navigation. It can also have **secondary or contributing themes** where the issue clearly spans multiple domains. Separately, it can have a **provenance theme set** derived from the union of labels on the supporting evidence. Those two things are not the same. One is semantic classification; the other is evidence heritage. This is my design inference from the literature and from the way current tools separate tags, topics, themes, findings, and evidence links. citeturn26view1turn27view8turn26view9turn27view10

This distinction matters a lot in practice. Condens describes a workflow where notes are tagged, related observations are clustered, and then the team analyses **how themes relate to each other** and converts what it has learned into outputs such as prioritised pain points and opportunity areas. That is the right direction: themes help organise evidence; problems are one kind of synthesised output built from that organised evidence. citeturn34view0turn34view1

So I would summarise the relationship like this:

An evidence snippet can belong to many topics or codes.  
A theme groups related topics, subcategories, or meaning patterns.  
A problem is an evidence-backed statement of friction or unmet need.  
A problem may be associated with one main theme and several contributing themes, but it should always keep its own direct links to the evidence that supports it. citeturn27view0turn27view2turn26view8turn26view2

## The model I would recommend for your app

If this app is for product, UX, VoC, or research-repository work, I would recommend the following conceptual model.

**Evidence** should be the atomic unit: quote, note, ticket excerpt, call clip, transcript highlight, survey comment. It should keep source metadata and remain directly retrievable. Tools like Dovetail and Condens both emphasise highlights and evidence-backed findings for this reason. citeturn27view8turn33view0

**Topic/code/tag** should be the snippet-level AI assignment. This is where multi-label assignment belongs. These can be AI-suggested, human-edited, or human-confirmed. Qualtrics, Dovetail, and Condens all support this sort of flexible tagging model, and qualitative methods literature treats codes as the building blocks of later synthesis. citeturn26view6turn32view0turn34view0turn27view0

**Subcategory or parent topic** should be optional, not mandatory. Turn it on when datasets become large, when multiple teams need governance, or when you need dashboards at different levels of abstraction. Qualtrics and MAXQDA both support deep hierarchies, which suggests that configurable hierarchy is a better long-term design than forcing every project into a fixed flat model. citeturn26view4turn26view5

**Theme** should be a higher-order pattern or strategic bucket. This is where labels like “Revenue uncertainty slows adoption” or “Self-serve setup breaks at the buying-to-doing transition” belong if you want language that behaves like a real theme and not just a topic bucket. Braun and Clarke’s standard here is that a theme has a coherent central organising concept, not just a shared subject label. citeturn27view0turn27view1turn27view3

**Problem** should be an evidence-backed problem statement, separate from both themes and raw tags. It should answer: who is affected, what is hard, and why it matters. That aligns with UX problem-statement practice and with the distinction between findings and insights. citeturn26view8turn26view7turn19view7

**Insight and opportunity** can optionally sit above the problem. An insight explains the why behind the problem; an opportunity frames where the team might act. Productboard, Miro, and Condens all effectively separate evidence, insight, and prioritised issues or opportunities in their guidance. citeturn26view9turn27view10turn34view1

I would also build in three safeguards from day one. First, keep an explicit **AI suggestion / human accepted / human edited** state. Dovetail already surfaces where AI contributed and where humans edited. Second, keep **confidence and support counts** on problems and themes, while remembering that frequency is not the same as importance. Third, keep a strong **audit trail** so every synthesis object can be inspected back to evidence. citeturn27view7turn31view3turn26view2

That human-review layer is especially important because recent research shows that simply showing annotators LLM suggestions can change the label distribution, increase confidence, and bias what humans accept, even when the assistance does not make them faster. AI is best used as an assistive first pass, not as unattended ground truth. citeturn25view0turn25view1turn25view2turn27view5turn26view0

## The wording I would use instead

If you want wording that is closer to both qualitative-methods literature and the shape of current product tooling, I would rewrite your explanation along these lines. This is a recommendation based on the distinctions above, not a quotation from any one source. citeturn27view0turn26view1turn26view8turn26view2

> A **topic** is an AI-suggested label attached to an individual evidence snippet during analysis. A snippet can carry more than one topic label when it clearly touches multiple areas.
>
> A **theme** is a higher-order pattern or strategic grouping created from related topics and evidence. Depending on scale, themes may contain subcategories or subthemes.
>
> A **problem** is an evidence-backed statement of friction or unmet need. It is not defined by the list of topics on its evidence, although those topics remain important as provenance.
>
> Problems should therefore keep:
> - direct links to the supporting evidence,
> - one primary theme for classification,
> - optional contributing themes for cross-cutting issues,
> - and a provenance trail showing which topics appeared in the underlying evidence.
>
> So if a problem is associated with both “pricing confusion” and “onboarding friction”, that should usually mean either:
> - the problem spans both areas, with one as primary and one as contributing, or
> - the evidence set includes both, even if the synthesised problem statement ultimately centres on one core issue.

## Open questions and limitations

A few design choices still depend on your exact audience. If your primary users are trained researchers, the terminology should lean more heavily toward **codes, categories, themes, findings, insights**. If your primary users are PMs, VoC teams, and CX leaders, **topics, themes, problems, opportunities** may be more immediately legible, as long as the underlying model still separates snippet-level labels from higher-order synthesis. citeturn26view1turn27view0turn26view7

The other unresolved choice is whether hierarchy should be **visible by default** or **available on demand**. Based on the market and the methods, my bias would be: keep the hierarchy in the data model from the start, but let smaller teams work in a flat way until complexity forces them upward. That gives you room to grow without imposing unnecessary ceremony on every project. citeturn26view4turn26view5turn21view0