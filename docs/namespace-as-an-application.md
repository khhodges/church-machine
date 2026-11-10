# The Namespace as an application

A Church Machine application is more than a single program. It brings together executable code, Threads, data, and the devices or services that code needs. A **Namespace** describes that collection through a table of named objects.

Think of the Namespace Designer as the application's assembly view: choose its components, assign them to slots, select its boot entry, and review how they fit together. Memory Glass shows the same selected Namespace as a memory layout.

## What makes up the application?

- **LUMPs** are packaged objects. Executable LUMPs carry code and their declared interfaces. Assigning an exact saved revision makes the application's inputs explicit.
- **Threads** hold execution state. A Thread is not simply another code file: it needs its own allocation and entry configuration.
- **MMIO entries** describe access to hardware registers, such as LEDs, buttons, timers, or a receiver. Their addresses refer to device registers, not ordinary RAM allocations.
- **The Namespace itself** describes the collection. In the new layout, slot 0 contains metadata, slot 1 describes the Namespace, and slot 2 is its entry Thread. The Original layout is retained separately; do not assume its slot arrangement is the same.

A row's name makes an object understandable to the programmer. Its slot, identity, revision, and capability relationships determine which object is actually used. A name or table entry alone is not permission to access it: instructions must use capabilities with the required authority, and the machine checks them at runtime.

## Reading the Namespace page

The selector chooses the design you are editing. **Saved design** means the design was loaded from saved data; **Unsaved local draft** means your edits still need to be saved. Neither status proves that this application is running on an FPGA.

The counts describe the selected design:

- **Max** is its slot capacity, including the metadata slot.
- **Assigned** counts its assigned objects.
- **Resident policy** identifies objects intended to occupy resident memory, including architectural resident objects.
- **Lazy policy** identifies objects intended to be resolved or loaded when needed rather than placed in the resident image.
- **Garbage** and **Free** describe cleared and available slots according to the selected layout.

The table lists each object's slot, saved revision where available, location, descriptor fields, and inspection or editing actions. **Unresolved**, **Unallocated**, or **Unbound** are meaningful states, not proof that the object is absent. Review its assignment and binding results rather than substituting another object by name.

## Working with the application

1. **Choose a Namespace.** Keep track of the selected design and its saved or unsaved state.
2. **Add and inspect its objects.** Use Add to Namespace, the row controls, and the appropriate object designer. Choose the intended saved LUMP revisions and load policies.
3. **Choose the boot entry.** Drag Boot entry onto the intended row. This configures the first abstraction invoked by the entry Thread; changing the selection does not run it.
4. **Bind Namespace Design.** In the new-layout designer, this saves the selected design and requests fresh C-list binding results. Review any errors. Binding does not activate a simulation or change an installed image. The Original view keeps Save Namespace Table and BIND as separate controls.
5. **Inspect Memory Glass.** Switch to the saved Namespace's memory layout, select objects, and return to their editors. Unsaved designer changes are retained, but the saved-layout view does not pretend they have already been saved.
6. **Prepare and review before transfer.** Prepare & Load FPGA opens the selected saved design's preparation view. Preparation and actual transfer are separate actions. An explicit hardware transfer can replace running memory and restart execution; inspect the confirmation before proceeding.

## What the other controls do

- **Reload saved design** reads the saved version again. It does not silently overwrite an unsaved Namespace draft.
- **Duplicate Namespace** creates an independent design copy. It does not inherit proof of testing or hardware approval.
- **Needs attention** opens a read-only report of issues in the saved Namespace.
- **Switch → Memory Glass** changes the view while preserving the selected Namespace. Switching does not save, bind, or send anything.

## Design, build, and running application are different

A saved Namespace is the application's design. A prepared image is a particular build of that design and its selected inputs. The running application is the image actually loaded into a simulator or a physical machine.

Keep those three states distinct. A successful save is not a successful bind; a successful bind is not an installation; and an inspected memory layout is not a live hardware readback.

This information popup is read-only. Opening or closing it does not change the Namespace, the current draft, or the FPGA.
