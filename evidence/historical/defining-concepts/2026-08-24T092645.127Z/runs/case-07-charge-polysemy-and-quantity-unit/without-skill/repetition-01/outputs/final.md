## Standardized semantic artifact

```yaml
concept_id: PHYS-ELECTROSTATICS-ELECTRIC-CHARGE

preferred_designation: electric charge
registry_designation: Charge
designation_status:
  "electric charge": preferred
  "charge": admitted_short_form_in_physics_context

part_of_speech: noun
domain: physics
subdomain: electromagnetism
concept_type: physical_quantity

definition: >
  Scalar physical quantity that characterizes a body's or particle's
  electromagnetic interaction and determines the electric force it exerts
  or experiences.

definition_type: intensional

symbol:
  usual: q
  alternatives: [Q]

quantity_kind: electric charge
si_unit:
  name: coulomb
  symbol: C
  expression: A·s

dimensional_formula: "I·T"

possible_values: >
  Positive, negative, or zero.

essential_characteristics:
  - Electric charge is the source of, and responds to, electric fields.
  - Like-signed charges repel and oppositely signed charges attract.
  - Total electric charge is conserved in an isolated system.
  - Charge is additive over a system's constituents.
  - Free-particle charge occurs in integer multiples of the elementary charge;
    quarks carry fractional elementary charges but are not observed in isolation.

governing_relations:
  coulomb_law: "F = (1 / 4πε₀) · |q₁q₂| / r²"
  current_relation: "I = dQ/dt"

reference_constant:
  name: elementary charge
  symbol: e
  exact_si_value: "1.602 176 634 × 10⁻¹⁹ C"

broader_concepts:
  - electromagnetic quantity
  - physical quantity

related_concepts:
  - electric field
  - electric current
  - electric potential
  - charge density
  - elementary charge
  - Coulomb's law

excluded_concepts:
  - price or fee
  - legal accusation
  - assigned duty or responsibility
  - battery state of charge
  - explosive charge
  - act of rushing or attacking

usage_example: >
  The electron has an electric charge of −e.

scope_note: >
  This entry denotes the measurable electromagnetic quantity, not a charged
  object, a process of charging, or any non-physics sense of “charge.”
```

Precision assessment: **“Charge” is not linguistically precise enough as an unqualified registry designation.** It is highly polysemous even within technical contexts, and in physics it can also refer informally to a charged particle, a distribution of charge, or the act of charging something.

Use **“Electric charge”** as the standardized preferred designation. Retain **“charge”** only as an admitted short form when the electromagnetism context is already explicit. If the glossary specifically concerns electrostatics, “electrostatic charge” may occur descriptively, but “electric charge” remains the conventional quantity name.